package websocket

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
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

// Global map to store active terminal sessions.
var terminalSessions = make(map[string]*TerminalSession)

// Unique session ID generator.
func generateSessionID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano()) // Using Unix time as a unique ID
}

// TerminalSession struct holds the terminal and related processes.
type TerminalSession struct {
	TTY *os.File
	Cmd *exec.Cmd
}

// HandleTerminalWebSocket handles WebSocket connections and manages the lifecycle of a terminal session.
func HandleTerminalWebSocket(w http.ResponseWriter, req *http.Request) {
	connection, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to upgrade connection")
		return
	}
	defer connection.Close()

	// Generate a unique session ID for each WebSocket connection
	sessionID := generateSessionID()

	// Start a new TTY session
	tty, cmd, err := startTTY()
	if err != nil {
		sendErrorMessage(connection, fmt.Sprintf("failed to start tty: %s", err))
		return
	}

	// Store the session in the global map
	terminalSessions[sessionID] = &TerminalSession{TTY: tty, Cmd: cmd}

	defer cleanupTTY(sessionID, tty, cmd, connection)

	var waiter sync.WaitGroup
	waiter.Add(2)

	lastPongTime := time.Now()
	setupKeepAlive(connection, &lastPongTime, &waiter)

	// Terminal output to WebSocket
	go readFromTTY(sessionID, tty, connection, &waiter)

	// WebSocket input to terminal
	go writeToTTY(sessionID, connection, tty)

	waiter.Wait()
	log.Info().Msg("Closing connection...")
}

// startTTY starts a new terminal session.
func startTTY() (*os.File, *exec.Cmd, error) {

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
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	tty, err := pty.Start(cmd)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to start TTY: %w", err)
	}

	return tty, cmd, nil
}

// cleanupTTY gracefully stops the terminal and closes the connection.
func cleanupTTY(sessionID string, tty *os.File, cmd *exec.Cmd, connection *websocket.Conn) {
	log.Info().Msg("Gracefully stopping spawned TTY...")

	// Remove the session from the global map
	delete(terminalSessions, sessionID)

	if err := cmd.Process.Kill(); err != nil {
		log.Warn().Err(err).Msg("Failed to kill process")
	}
	if _, err := cmd.Process.Wait(); err != nil {
		log.Warn().Err(err).Msg("Failed to wait for process to exit")
	}
	if err := tty.Close(); err != nil {
		log.Warn().Err(err).Msg("Failed to close spawned TTY gracefully")
	}
	if err := connection.Close(); err != nil {
		log.Warn().Err(err).Msg("Failed to close WebSocket connection")
	}
}

// sendErrorMessage sends an error message over WebSocket.
func sendErrorMessage(connection *websocket.Conn, message string) {
	log.Warn().Msg(message)
	if err := connection.WriteMessage(websocket.TextMessage, []byte(message)); err != nil {
		log.Warn().Err(err).Msg("Failed to send error message over WebSocket")
	}
}

// setupKeepAlive sets up the ping/pong keep-alive mechanism for the WebSocket connection.
func setupKeepAlive(connection *websocket.Conn, lastPongTime *time.Time, waiter *sync.WaitGroup) {
	connection.SetPongHandler(func(msg string) error {
		*lastPongTime = time.Now()
		return nil
	})

	go func() {
		defer waiter.Done()
		for {
			if err := connection.WriteMessage(websocket.PingMessage, []byte("keepalive")); err != nil {
				log.Warn().Err(err).Msg("Failed to write ping message")
				return
			}
			time.Sleep(KeepAlivePingTimeout / 2)
			if time.Since(*lastPongTime) > KeepAlivePingTimeout {
				log.Warn().Msg("Failed to get response from ping, triggering disconnect")
				return
			}
			log.Debug().Msg("Received response from ping successfully")
		}
	}()
}

// readFromTTY reads output from the TTY and sends it to the WebSocket connection.
func readFromTTY(sessionID string, tty *os.File, connection *websocket.Conn, waiter *sync.WaitGroup) {
	defer waiter.Done()
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
func writeToTTY(sessionID string, connection *websocket.Conn, tty *os.File) {
	for {
		messageType, data, err := connection.ReadMessage()
		if err != nil {
			log.Warn().Err(err).Msg("Failed to read WebSocket message")
			return
		}

		dataLength := len(data)
		dataBuffer := bytes.Trim(data, "\x00")

		dataType := getMessageType(messageType)
		log.Info().Msgf("Received %s (type: %v) message of size %v byte(s)", dataType, messageType, dataLength)

		if messageType == websocket.BinaryMessage {
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

	log.Info().Msgf("Resizing TTY to %d rows and %d columns", ttySize.Rows, ttySize.Cols)
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
