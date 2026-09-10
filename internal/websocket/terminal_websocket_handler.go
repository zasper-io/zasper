package websocket

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/core"
)

const (
	DefaultConnectionErrorLimit = 10
	MaxBufferSizeBytes          = 512
	KeepAlivePingTimeout        = 20 * time.Second
)

type TTYSize struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
	X    uint16 `json:"x"`
	Y    uint16 `json:"y"`
}

var WebsocketMessageType = map[int]string{
	websocket.BinaryMessage: "binary",
	websocket.TextMessage:   "text",
	websocket.CloseMessage:  "close",
	websocket.PingMessage:   "ping",
	websocket.PongMessage:   "pong",
}

/*
terminalConn is the websocket with the two things this handler does to it concurrently made safe.

gorilla/websocket permits one reader and one writer at a time and no more, and this handler has two
writers: readFromTTY, pumping the shell's output out, and the keep-alive goroutine sending its
pings. They interleave inside a single frame, which corrupts the stream rather than merely racing.
The last pong is the same problem the other way round — written by the pong handler, which runs on
the read goroutine, and read by the keep-alive goroutine deciding whether the client is still there.

Nothing had ever driven both at once, because nothing had ever opened a terminal in a test.
*/
type terminalConn struct {
	*websocket.Conn

	writeMu sync.Mutex
	// Unix nanoseconds, so that the two goroutines share a word rather than a time.Time.
	lastPong atomic.Int64
}

func newTerminalConn(conn *websocket.Conn) *terminalConn {
	answer := &terminalConn{Conn: conn}
	answer.markPong()
	return answer
}

// WriteMessage shadows the embedded connection's, which is the whole point: every writer in this
// file goes through here.
func (c *terminalConn) WriteMessage(messageType int, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	return c.Conn.WriteMessage(messageType, data)
}

func (c *terminalConn) markPong() {
	c.lastPong.Store(time.Now().UnixNano())
}

func (c *terminalConn) sincePong() time.Duration {
	return time.Since(time.Unix(0, c.lastPong.Load()))
}

// Global map to store active terminal sessions, keyed by connection ID. Written
// from every connection's goroutine, so it is guarded by terminalSessionsMu.
var (
	terminalSessions   = make(map[string]*TerminalSession)
	terminalSessionsMu sync.Mutex
)

// Counts the sessions this process has handed out, which is what actually makes their ids unique.
var terminalSessionSeq atomic.Uint64

/*
generateSessionID names one connection's shell.

The terminal id identifies the client tab; the counter keeps reconnects of the same tab from
colliding with a session that is still shutting down, and keeps two tabs opened together apart.

The counter is there because the timestamp alone was not enough. `time.Now().UnixNano()` reads a
wall clock that is far coarser than a nanosecond — on macOS a thousand calls in a loop land on about
thirty-six distinct values — so two terminals opened in the same tick were handed the same id, and
the second registration evicted the first from the session map. That left a shell running that
nothing could list or kill, and now that the id is what /api/terminals reports and DELETE names, a
collision would also shut down the wrong terminal. The timestamp is kept for the log lines.
*/
func generateSessionID(terminalId string) string {
	return fmt.Sprintf("%s-%d-%d", terminalId, terminalSessionSeq.Add(1), time.Now().UnixNano())
}

func registerTerminalSession(sessionID string, session *TerminalSession) {
	terminalSessionsMu.Lock()
	defer terminalSessionsMu.Unlock()
	terminalSessions[sessionID] = session
}

func unregisterTerminalSession(sessionID string) {
	terminalSessionsMu.Lock()
	defer terminalSessionsMu.Unlock()
	delete(terminalSessions, sessionID)
}

// TerminalSession struct holds the terminal and related processes.
type TerminalSession struct {
	TTY *os.File
	Cmd *exec.Cmd

	// What the client calls this terminal — "Terminal 1", the name of the tab it is drawn in. Not
	// unique on its own: every window numbers its terminals from one, which is why the API reports
	// the session id beside it.
	Name string
	// The folder the shell was started in, as an OS path.
	Dir string
	// When the shell was started, so the list can be given a stable order.
	Started time.Time

	stopOnce sync.Once
}

/*
stop kills the shell.

Both the connection's own cleanup and a DELETE from the API reach it, in either order and from
different goroutines, so it has to be safe to call twice: the second Kill would be an error about a
process that has already finished, and the second Wait a second reap of the same child.
*/
func (s *TerminalSession) stop() {
	s.stopOnce.Do(func() {
		if s.Cmd == nil || s.Cmd.Process == nil {
			return
		}
		if err := s.Cmd.Process.Kill(); err != nil {
			// Most often the shell exited on its own — somebody typed `exit` — and is a zombie waiting
			// to be reaped, which is what the Wait below is for. So the reap is not skipped over.
			log.Warn().Err(err).Msg("Failed to kill process")
		}
		if _, err := s.Cmd.Process.Wait(); err != nil {
			log.Warn().Err(err).Msg("Failed to wait for process to exit")
		}
	})
}

// HandleTerminalWebSocket handles WebSocket connections and manages the lifecycle of a terminal session.
func HandleTerminalWebSocket(w http.ResponseWriter, req *http.Request) {
	upgraded, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to upgrade connection")
		return
	}
	connection := newTerminalConn(upgraded)
	defer connection.Close()

	// Generate a unique session ID for each WebSocket connection, tagged with the
	// terminal the client asked for.
	terminalId := mux.Vars(req)["terminalId"]
	sessionID := generateSessionID(terminalId)
	log.Debug().Msgf("Opening terminal session %s for terminal %s", sessionID, terminalId)

	// Start a new TTY session, in the folder the client asked for if it asked for one.
	dir := terminalWorkingDir(req.URL.Query().Get("cwd"))
	tty, cmd, err := startTTY(dir)
	if err != nil {
		sendErrorMessage(connection, fmt.Sprintf("failed to start tty: %s", err))
		return
	}

	// Store the session in the global map, which is also what /api/terminals answers from.
	session := &TerminalSession{TTY: tty, Cmd: cmd, Name: terminalId, Dir: dir, Started: time.Now().UTC()}
	registerTerminalSession(sessionID, session)

	defer cleanupTTY(sessionID, session, connection)

	/*
		Whichever of the three ends first ends the other two.

		The shell exiting, the client going away and the keep-alive giving up are one event as far as this
		terminal is concerned, and none of them is heard by all three goroutines on its own. Only two used
		to be waited on, and readFromTTY — one of the two — sits in a blocking read of a pty that an idle
		shell is never going to write to again, so a browser closed on an idle shell left waiter.Wait()
		parked for the life of the server: the shell went on running and its session was never
		unregistered. Killing the shell is what unblocks that read, and closing the socket is what unblocks
		the other two.
	*/
	var waiter sync.WaitGroup
	waiter.Add(3)
	done := make(chan struct{})
	var closeDone sync.Once
	finish := func() {
		waiter.Done()
		closeDone.Do(func() { close(done) })
		// Out of the map here rather than in cleanupTTY, which runs only once all three have stopped:
		// the shell is dead from the line below, and a terminal listed for as long as the keep-alive
		// takes to notice is a row the panel offers to shut down twice.
		unregisterTerminalSession(sessionID)
		session.stop()
		connection.Close()
	}

	go func() { defer finish(); keepAlive(connection, done) }()

	// Terminal output to WebSocket
	go func() { defer finish(); readFromTTY(sessionID, tty, connection) }()

	// WebSocket input to terminal
	go func() { defer finish(); writeToTTY(sessionID, connection, tty) }()

	waiter.Wait()
	log.Debug().Msg("Closing connection...")
}

/*
terminalWorkingDir turns the folder the client asked for into an OS path, falling back to the project
root for anything that is not a folder inside the project. A shell is the one place where landing in
the wrong directory is worth being careful about, so a bad answer is refused rather than passed on.
*/
func terminalWorkingDir(relativePath string) string {
	if relativePath == "" {
		return core.Zasper.HomeDir
	}

	osPath := content.GetSafePath(relativePath)
	if osPath == "" {
		log.Warn().Msgf("Terminal asked to start outside the project: %s", relativePath)
		return core.Zasper.HomeDir
	}

	info, err := os.Stat(osPath)
	if err != nil || !info.IsDir() {
		log.Warn().Msgf("Terminal asked to start somewhere that is not a folder: %s", relativePath)
		return core.Zasper.HomeDir
	}
	return osPath
}

// startTTY starts a new terminal session in dir.
func startTTY(dir string) (*os.File, *exec.Cmd, error) {

	terminal := "zsh"
	osystem := core.Zasper.OSName

	switch osystem {
	case "windows":
		terminal = "bash"
	case "linux":
		terminal = "bash"
	case "freebsd":
		terminal = "bash"
	case "android":
		terminal = "bash"
	default:
		terminal = "zsh"
	}

	args := []string{"-l"}
	log.Debug().Msgf("Starting new TTY using command '%s' with arguments ['%s']...", terminal, args)

	cmd := exec.Command(terminal, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	tty, err := pty.Start(cmd)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to start TTY: %w", err)
	}

	return tty, cmd, nil
}

// cleanupTTY gracefully stops the terminal and closes the connection.
func cleanupTTY(sessionID string, session *TerminalSession, connection *terminalConn) {
	log.Debug().Msg("Gracefully stopping spawned TTY...")

	// The session was taken out of the map and the shell killed the moment any one of this terminal's
	// three goroutines stopped; both are repeated here because this also runs on the paths where the
	// handler gives up before that, and both are safe to do twice.
	unregisterTerminalSession(sessionID)
	session.stop()

	if err := session.TTY.Close(); err != nil {
		log.Warn().Err(err).Msg("Failed to close spawned TTY gracefully")
	}
	if err := connection.Close(); err != nil {
		log.Warn().Err(err).Msg("Failed to close WebSocket connection")
	}
}

// sendErrorMessage sends an error message over WebSocket.
func sendErrorMessage(connection *terminalConn, message string) {
	log.Warn().Msg(message)
	if err := connection.WriteMessage(websocket.TextMessage, []byte(message)); err != nil {
		log.Warn().Err(err).Msg("Failed to send error message over WebSocket")
	}
}

// keepAlive pings the client until one goes unanswered, which is how a browser that vanished without
// closing its socket is told from one that is simply idle. It returns on the first sign of either, or
// as soon as `done` says the terminal is over — which it waits on rather than sleeping through,
// because the handler cannot close the pty until this returns and ten seconds is a long time to hold
// a file descriptor for a shell that is already dead.
func keepAlive(connection *terminalConn, done <-chan struct{}) {
	connection.SetPongHandler(func(msg string) error {
		connection.markPong()
		return nil
	})

	for {
		if err := connection.WriteMessage(websocket.PingMessage, []byte("keepalive")); err != nil {
			log.Warn().Err(err).Msg("Failed to write ping message")
			return
		}
		select {
		case <-done:
			return
		case <-time.After(KeepAlivePingTimeout / 2):
		}
		if connection.sincePong() > KeepAlivePingTimeout {
			log.Warn().Msg("Failed to get response from ping, triggering disconnect")
			return
		}
		log.Debug().Msg("Received response from ping successfully")
	}
}

// readFromTTY reads output from the TTY and sends it to the WebSocket connection.
func readFromTTY(sessionID string, tty *os.File, connection *terminalConn) {
	errorCounter := 0

	for {
		if errorCounter > DefaultConnectionErrorLimit {
			break
		}
		buffer := make([]byte, MaxBufferSizeBytes)
		readLength, err := tty.Read(buffer)
		if err != nil {
			// If the terminal process is closed or error occurs, handle it
			log.Warn().Err(err).Msg("Failed to read from TTY")
			sendErrorMessage(connection, "Bye!")
			break
		}

		if err := connection.WriteMessage(websocket.BinaryMessage, buffer[:readLength]); err != nil {
			log.Warn().Err(err).Msgf("Failed to send %d bytes from TTY to WebSocket", readLength)
			errorCounter++
			continue
		}

		log.Trace().Msgf("Sent message of size %d bytes from TTY to WebSocket", readLength)
		errorCounter = 0
	}
}

// writeToTTY writes incoming WebSocket messages to the TTY.
func writeToTTY(sessionID string, connection *terminalConn, tty *os.File) {
	for {
		messageType, data, err := connection.ReadMessage()
		if err != nil {
			log.Warn().Err(err).Msg("Failed to read WebSocket message")
			return
		}

		dataLength := len(data)
		dataBuffer := bytes.Trim(data, "\x00")

		dataType := getMessageType(messageType)
		log.Debug().Msgf("Received %s (type: %v) message of size %v byte(s)", dataType, messageType, dataLength)

		// The length check is the guard: a client can send an empty binary frame, and one of nothing
		// but NULs trims down to the same thing, so reading the marker byte without asking whether
		// there was one panicked this goroutine on a frame anybody could send.
		if messageType == websocket.BinaryMessage && len(dataBuffer) > 0 {
			if dataBuffer[0] == 1 {
				handleResizeMessage(dataBuffer, tty)
				continue
			}
		}

		if err := writeDataToTTY(dataBuffer, tty); err != nil {
			log.Warn().Err(err).Msg("Failed to write data to TTY")
		}
	}
}

// getMessageType returns a string representation of the WebSocket message type.
func getMessageType(messageType int) string {
	if dataType, ok := WebsocketMessageType[messageType]; ok {
		return dataType
	}
	return "unknown"
}

// handleResizeMessage processes the terminal resize message and resizes the TTY accordingly.
func handleResizeMessage(dataBuffer []byte, tty *os.File) {

	ttySize := &TTYSize{}
	resizeMessage := bytes.Trim(dataBuffer[1:], " \n\r\t\x00\x01")
	if err := json.Unmarshal(resizeMessage, ttySize); err != nil {
		log.Warn().Err(err).Msgf("Failed to unmarshal resize message: %s", string(resizeMessage))
		return
	}

	log.Debug().Msgf("Resizing TTY to %d rows and %d columns", ttySize.Rows, ttySize.Cols)
	if err := pty.Setsize(tty, &pty.Winsize{
		Rows: ttySize.Rows,
		Cols: ttySize.Cols,
	}); err != nil {
		log.Warn().Err(err).Msg("Failed to resize TTY")
	}

}

// writeDataToTTY writes the data to the TTY and logs the operation.
func writeDataToTTY(data []byte, tty *os.File) error {
	bytesWritten, err := tty.Write(data)
	if err != nil {
		return fmt.Errorf("failed to write %d bytes to TTY: %w", len(data), err)
	}
	log.Trace().Msgf("%d bytes written to TTY", bytesWritten)
	return nil
}
