/*
The terminal endpoint: where a shell is started, and what a client may send it.

Until these, the only thing covered here was terminalWorkingDir — the pure helper that decides where
a shell starts — while the pty half of the file, which spawns that shell and pipes a websocket into
it, had none. It is the route that hands out a shell on this machine, so what it does with a frame it
did not expect is worth writing down.

The one it did not expect was an empty binary frame. The resize branch read dataBuffer[0] to see
whether the frame was a resize, without asking whether there was a byte to read, and any client could
send a frame of no bytes.

A real pty and a real shell are used rather than a stand-in, which is what requireShell guards.
core.Zasper.HomeDir is process-wide, so nothing here runs in parallel.
*/
package websocket

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zasper-io/zasper/internal/core"
)

// requireShell skips when the shell startTTY would reach for is not installed — bash on linux, zsh
// everywhere else. Same shape as requireGit and requireKernel elsewhere in the suite.
func requireShell(t *testing.T) {
	t.Helper()

	// startTTY chooses its shell from core.Zasper.OSName, which a bare test process leaves empty —
	// and empty falls through to zsh, which ubuntu does not ship. Without this the pty tests would
	// skip on CI while passing here, which is the worst of both.
	previous := core.Zasper.OSName
	core.Zasper.OSName = runtime.GOOS
	t.Cleanup(func() { core.Zasper.OSName = previous })

	shell := "zsh"
	switch core.Zasper.OSName {
	case "windows", "linux", "freebsd", "android":
		shell = "bash"
	}
	if _, err := exec.LookPath(shell); err != nil {
		t.Skipf("no %s binary is installed", shell)
	}
}

// aTTY starts a shell in a throwaway directory and answers its pty, cleaned up with the test.
func aTTY(t *testing.T) *os.File {
	t.Helper()
	requireShell(t)

	tty, cmd, err := startTTY(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() {
		cmd.Process.Kill()
		cmd.Process.Wait()
		tty.Close()
	})
	return tty
}

func projectDir(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	previous := core.Zasper.HomeDir
	core.Zasper.HomeDir = dir
	t.Cleanup(func() { core.Zasper.HomeDir = previous })
	return dir
}

func TestTerminalStartsInTheFolderItWasOpenedFrom(t *testing.T) {
	dir := projectDir(t)
	assert.NoError(t, os.MkdirAll(filepath.Join(dir, "src", "deep"), 0o755))

	assert.Equal(t, filepath.Join(dir, "src", "deep"), terminalWorkingDir("src/deep"))
}

func TestTerminalFallsBackToTheProjectRoot(t *testing.T) {
	dir := projectDir(t)
	assert.NoError(t, os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("hi"), 0o644))

	cases := map[string]string{
		"nothing asked for":      "",
		"outside the project":    "../elsewhere",
		"a file, not a folder":   "notes.txt",
		"a folder that has gone": "src",
	}

	for name, path := range cases {
		t.Run(name, func(t *testing.T) {
			// A shell in the wrong directory writes to the wrong place, so a bad answer is
			// refused rather than passed on to exec.
			assert.Equal(t, dir, terminalWorkingDir(path))
		})
	}
}

func TestEveryWebsocketMessageTypeHasAName(t *testing.T) {
	cases := map[int]string{
		websocket.BinaryMessage: "binary",
		websocket.TextMessage:   "text",
		websocket.CloseMessage:  "close",
		websocket.PingMessage:   "ping",
		websocket.PongMessage:   "pong",
		// Only the five above are named; anything else is reported rather than left blank, since
		// this only ever reaches a log line.
		99: "unknown",
		0:  "unknown",
	}

	for messageType, want := range cases {
		t.Run(want, func(t *testing.T) {
			assert.Equal(t, want, getMessageType(messageType))
		})
	}
}

func TestWhatIsWrittenToTheTTYReachesTheShell(t *testing.T) {
	tty := aTTY(t)

	require.NoError(t, writeDataToTTY([]byte("echo zasper-was-here\n"), tty))

	// A pty is not a file that takes a deadline — SetReadDeadline answers "file type does not
	// support deadline" — so the read runs on its own goroutine and the test waits on what it
	// finds. The goroutine ends when the cleanup closes the pty under it.
	found := make(chan struct{})
	go func() {
		var seen strings.Builder
		for {
			buffer := make([]byte, MaxBufferSizeBytes)
			n, err := tty.Read(buffer)
			if err != nil {
				return
			}
			// The shell echoes the line back and then runs it, so the marker arrives twice.
			seen.Write(buffer[:n])
			if strings.Contains(seen.String(), "zasper-was-here") {
				close(found)
				return
			}
		}
	}()

	select {
	case <-found:
	case <-time.After(15 * time.Second):
		t.Fatal("the shell never echoed back what was written to it")
	}
}

func TestWritingToATTYThatHasGoneIsAnErrorRatherThanAPanic(t *testing.T) {
	requireShell(t)

	tty, cmd, err := startTTY(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, cmd.Process.Kill())
	cmd.Process.Wait()
	require.NoError(t, tty.Close())

	assert.Error(t, writeDataToTTY([]byte("echo hello\n"), tty))
}

func TestAResizeMessageSetsTheWindow(t *testing.T) {
	tty := aTTY(t)

	// The wire shape: a leading 1 marking the frame as a resize, then the JSON.
	size, err := json.Marshal(TTYSize{Cols: 120, Rows: 40})
	require.NoError(t, err)
	handleResizeMessage(append([]byte{1}, size...), tty)

	got, err := pty.GetsizeFull(tty)
	require.NoError(t, err)
	assert.Equal(t, uint16(120), got.Cols)
	assert.Equal(t, uint16(40), got.Rows)
}

/*
A resize message the client got wrong leaves the window alone.

handleResizeMessage slices its buffer at [1:] to get past the marker byte, so it is only ever safe
because writeToTTY has already looked at [0]. Both halves are checked here: a short or malformed
frame must not panic, and must not resize to nothing either.
*/
func TestAMalformedResizeMessageIsIgnored(t *testing.T) {
	tty := aTTY(t)

	size, err := json.Marshal(TTYSize{Cols: 100, Rows: 30})
	require.NoError(t, err)
	handleResizeMessage(append([]byte{1}, size...), tty)

	cases := map[string][]byte{
		"the marker and nothing else": {1},
		"not json at all":             append([]byte{1}, []byte("hello")...),
		"json of the wrong shape":     append([]byte{1}, []byte(`["cols", 10]`)...),
		"truncated json":              append([]byte{1}, []byte(`{"cols": 12`)...),
	}

	for name, message := range cases {
		t.Run(name, func(t *testing.T) {
			handleResizeMessage(message, tty)

			got, err := pty.GetsizeFull(tty)
			require.NoError(t, err)
			assert.Equal(t, uint16(100), got.Cols, "the window was resized by a bad message")
			assert.Equal(t, uint16(30), got.Rows)
		})
	}
}

// The store the handler keeps its live sessions in. One map for the whole process, so a test that
// left a session behind would be the next one's starting point.
func TestATerminalSessionIsRememberedUntilItIsUnregistered(t *testing.T) {
	session := &TerminalSession{}

	registerTerminalSession("tab-1-123", session)
	terminalSessionsMu.Lock()
	assert.Same(t, session, terminalSessions["tab-1-123"])
	terminalSessionsMu.Unlock()

	unregisterTerminalSession("tab-1-123")
	terminalSessionsMu.Lock()
	_, found := terminalSessions["tab-1-123"]
	terminalSessionsMu.Unlock()
	assert.False(t, found)

	// Unregistering something that was never there is not an error: cleanupTTY runs on every exit
	// path, including the one where the session never got registered.
	assert.NotPanics(t, func() { unregisterTerminalSession("never-existed") })
}

// The id is what keeps a reconnecting tab from colliding with the session it is replacing, which is
// only true if two calls for the same tab differ.
func TestEachTerminalSessionGetsItsOwnId(t *testing.T) {
	seen := map[string]bool{}
	for range 100 {
		id := generateSessionID("tab-1")
		assert.False(t, seen[id], "id %s was handed out twice", id)
		assert.True(t, strings.HasPrefix(id, "tab-1-"))
		seen[id] = true
	}
}

// Every connection writes to the session store from its own goroutine. Go's answer to a concurrent
// map write is to kill the process, so the assertion is largely that we got here; -race does the
// rest.
func TestTheTerminalSessionStoreSurvivesEverythingAtOnce(t *testing.T) {
	const workers = 8
	const each = 200

	var waiter sync.WaitGroup
	for worker := range workers {
		waiter.Add(1)
		go func() {
			defer waiter.Done()
			for i := range each {
				id := fmt.Sprintf("tab-%d-%d", worker, i)
				registerTerminalSession(id, &TerminalSession{})
				unregisterTerminalSession(id)
			}
		}()
	}
	waiter.Wait()

	terminalSessionsMu.Lock()
	defer terminalSessionsMu.Unlock()
	assert.Empty(t, terminalSessions)
}

/*
A whole terminal, from the upgrade to the shell's own output.

The one test here that goes through HandleTerminalWebSocket rather than around it, so it is the one
that covers the pty lifecycle: the session registered, the shell started in the right directory, the
output pumped back, and the frames a client can send.
*/
func TestATerminalRunsWhatTheClientTypes(t *testing.T) {
	requireShell(t)
	dir := projectDir(t)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "marker-file.txt"), []byte("x"), 0o644))

	srv := httptest.NewServer(http.HandlerFunc(HandleTerminalWebSocket))
	defer srv.Close()

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	require.NoError(t, err)
	defer conn.Close()

	// An empty binary frame, which is what used to take the handler down: the resize branch read
	// its first byte without asking whether there was one.
	require.NoError(t, conn.WriteMessage(websocket.BinaryMessage, []byte{}))
	// And one of nothing but NULs, which bytes.Trim reduces to the same thing.
	require.NoError(t, conn.WriteMessage(websocket.BinaryMessage, []byte{0, 0, 0}))

	// The shell is still there and still listening, which is the whole point.
	size, err := json.Marshal(TTYSize{Cols: 80, Rows: 24})
	require.NoError(t, err)
	require.NoError(t, conn.WriteMessage(websocket.BinaryMessage, append([]byte{1}, size...)))
	require.NoError(t, conn.WriteMessage(websocket.BinaryMessage, []byte("ls\n")))

	require.NoError(t, conn.SetReadDeadline(time.Now().Add(20*time.Second)))
	var seen strings.Builder
	for !strings.Contains(seen.String(), "marker-file.txt") {
		_, data, err := conn.ReadMessage()
		require.NoError(t, err, "read what we could: %q", seen.String())
		seen.Write(data)
	}
}

/*
A client that goes away takes its shell with it.

The handler waited on two goroutines, and one of them — readFromTTY — sits in a blocking read of a
pty. An idle shell writes nothing, so closing the browser on one left that read parked, the wait
never returned, cleanupTTY never ran, and the shell went on running for the life of the server with
its session still in the map. Nothing showed it until /api/terminals started reporting that map:
every window anyone had ever closed left a row in the panel and a zsh in `ps`.
*/
func TestClosingTheConnectionOnAnIdleShellEndsIt(t *testing.T) {
	requireShell(t)
	projectDir(t)

	srv := httptest.NewServer(http.HandlerFunc(HandleTerminalWebSocket))
	defer srv.Close()

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	require.NoError(t, err)

	// Wait for the shell rather than assume it: the session is registered on the handler's goroutine.
	require.Eventually(t, func() bool { return len(ListTerminals()) == 1 }, 10*time.Second, 20*time.Millisecond)

	// Held on to across the close, because the assertion afterwards is about this shell and the map it
	// can be looked up in is the thing being emptied.
	terminalSessionsMu.Lock()
	var shell *os.Process
	for _, session := range terminalSessions {
		shell = session.Cmd.Process
	}
	terminalSessionsMu.Unlock()
	require.NotNil(t, shell)

	// Nothing is typed, so the pty has nothing more to say — which is the case that used to hang.
	require.NoError(t, conn.Close())

	// Comfortably under the keep-alive's own ten-second wait, which the handler used to sit through
	// before it would unregister anything.
	require.Eventually(t, func() bool { return len(ListTerminals()) == 0 }, 5*time.Second, 20*time.Millisecond,
		"the session outlived the connection")

	// And the shell itself, not merely the bookkeeping about it. Signalling a process Go has already
	// reaped is an error, which is what a shell that is gone looks like from here.
	assert.Error(t, shell.Signal(syscall.Signal(0)), "the shell outlived the connection")
}
