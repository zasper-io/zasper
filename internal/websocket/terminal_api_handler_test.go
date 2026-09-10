/*
What /api/terminals reports, and what a DELETE to it does.

The panel that reads these used to list the terminal tabs the browser window had open, which meant it
emptied on a reload while the shells went on running and went on naming a shell somebody had typed
`exit` into. These endpoints are what it reads instead, so the two things worth pinning down are that
the list says what the session map holds and that a shutdown reaches the right shell.

core.Zasper.HomeDir and the session map are both process-wide, so nothing here runs in parallel.
*/
package websocket

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// aSession registers a session that is not attached to any shell — enough for everything here except
// the kill, which is covered against a real process below — and takes it out again with the test.
func aSession(t *testing.T, id string, session *TerminalSession) *TerminalSession {
	t.Helper()

	registerTerminalSession(id, session)
	t.Cleanup(func() { unregisterTerminalSession(id) })
	return session
}

func TestTheTerminalListReportsWhatTheServerIsRunning(t *testing.T) {
	dir := projectDir(t)
	start := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)

	// Out of order on purpose: the map has none, and the list is meant to impose one.
	aSession(t, "Terminal 2-2-x", &TerminalSession{
		Name: "Terminal 2", Dir: filepath.Join(dir, "src", "deep"), Started: start.Add(time.Minute),
	})
	aSession(t, "Terminal 1-1-x", &TerminalSession{
		Name: "Terminal 1", Dir: dir, Started: start,
	})

	listed := ListTerminals()
	require.Len(t, listed, 2)

	assert.Equal(t, "Terminal 1-1-x", listed[0].ID)
	assert.Equal(t, "Terminal 1", listed[0].Name)
	// The project root itself is reported as no folder rather than as a dot.
	assert.Equal(t, "", listed[0].Dir)
	assert.Equal(t, "2026-09-10T08:00:00Z", listed[0].Started)

	assert.Equal(t, "Terminal 2-2-x", listed[1].ID, "the older shell should come first")
	assert.Equal(t, filepath.Join("src", "deep"), listed[1].Dir)
}

// Two windows each number their terminals from one, so the name cannot be the handle. Both rows are
// listed, and each carries the id a shutdown has to name.
func TestTwoTerminalsOfTheSameNameAreBothListed(t *testing.T) {
	dir := projectDir(t)
	aSession(t, "Terminal 1-1-x", &TerminalSession{Name: "Terminal 1", Dir: dir})
	aSession(t, "Terminal 1-2-x", &TerminalSession{Name: "Terminal 1", Dir: dir})

	listed := ListTerminals()
	require.Len(t, listed, 2)
	assert.Equal(t, "Terminal 1", listed[0].Name)
	assert.Equal(t, "Terminal 1", listed[1].Name)
	assert.NotEqual(t, listed[0].ID, listed[1].ID)
}

// A shell started outside the project — nothing does that today, but the field is a path off disk —
// is reported as where it is rather than as a run of `..` segments.
func TestAShellOutsideTheProjectIsReportedByItsRealPath(t *testing.T) {
	projectDir(t)
	outside := t.TempDir()

	aSession(t, "Terminal 1-1-x", &TerminalSession{Name: "Terminal 1", Dir: outside})

	listed := ListTerminals()
	require.Len(t, listed, 1)
	assert.Equal(t, outside, listed[0].Dir)
}

func TestKillingATerminalStopsItsShell(t *testing.T) {
	requireShell(t)

	tty, cmd, err := startTTY(t.TempDir())
	require.NoError(t, err)
	defer tty.Close()

	aSession(t, "Terminal 1-1-x", &TerminalSession{TTY: tty, Cmd: cmd, Name: "Terminal 1"})

	require.NoError(t, KillTerminal("Terminal 1-1-x"))
	// Signal 0 asks the kernel whether the process is still there without sending anything.
	assert.Error(t, cmd.Process.Signal(syscall.Signal(0)), "the shell should be gone")
}

// The session stays in the map until its own connection notices and unregisters it, so a second
// shutdown of the same terminal is something the panel can send. It must not reap the child twice.
func TestKillingATerminalTwiceIsHarmless(t *testing.T) {
	requireShell(t)

	tty, cmd, err := startTTY(t.TempDir())
	require.NoError(t, err)
	defer tty.Close()

	aSession(t, "Terminal 1-1-x", &TerminalSession{TTY: tty, Cmd: cmd, Name: "Terminal 1"})

	require.NoError(t, KillTerminal("Terminal 1-1-x"))
	assert.NotPanics(t, func() { assert.NoError(t, KillTerminal("Terminal 1-1-x")) })
}

func TestKillingATerminalThatIsNotThereSaysSo(t *testing.T) {
	assert.ErrorIs(t, KillTerminal("never-existed"), ErrTerminalNotFound)
}

// A session that never got a shell — the window between registering and startTTY failing — must not
// take the process down when something asks for it to be killed.
func TestKillingATerminalWithNoProcessIsHarmless(t *testing.T) {
	aSession(t, "Terminal 1-1-x", &TerminalSession{Name: "Terminal 1"})
	assert.NotPanics(t, func() { assert.NoError(t, KillTerminal("Terminal 1-1-x")) })
}

func TestTheTerminalListEndpointAnswersAnArray(t *testing.T) {
	dir := projectDir(t)
	aSession(t, "Terminal 1-1-x", &TerminalSession{Name: "Terminal 1", Dir: dir})

	recorder := httptest.NewRecorder()
	TerminalListAPIHandler(recorder, httptest.NewRequest(http.MethodGet, "/api/terminals", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "application/json", recorder.Header().Get("Content-Type"))

	var listed []TerminalModel
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &listed))
	require.Len(t, listed, 1)
	assert.Equal(t, "Terminal 1", listed[0].Name)
}

// An empty list is `[]` and not `null`, which the frontend would have to guard against separately.
func TestTheTerminalListEndpointAnswersAnEmptyArrayWhenNothingIsRunning(t *testing.T) {
	recorder := httptest.NewRecorder()
	TerminalListAPIHandler(recorder, httptest.NewRequest(http.MethodGet, "/api/terminals", nil))

	assert.Equal(t, "[]\n", recorder.Body.String())
}

// The id carries the terminal's name, so it has a space in it and reaches the handler percent-encoded.
func TestTheTerminalDeleteEndpointTakesAnEncodedId(t *testing.T) {
	aSession(t, "Terminal 1-1-x", &TerminalSession{Name: "Terminal 1"})

	recorder := httptest.NewRecorder()
	router := mux.NewRouter()
	router.HandleFunc("/api/terminals/{terminalId}", TerminalKillAPIHandler).Methods(http.MethodDelete)
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/api/terminals/Terminal%201-1-x", nil))

	assert.Equal(t, http.StatusOK, recorder.Code)
}

func TestTheTerminalDeleteEndpointIsA404ForAnIdNothingIsRunning(t *testing.T) {
	recorder := httptest.NewRecorder()
	router := mux.NewRouter()
	router.HandleFunc("/api/terminals/{terminalId}", TerminalKillAPIHandler).Methods(http.MethodDelete)
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/api/terminals/never-existed", nil))

	assert.Equal(t, http.StatusNotFound, recorder.Code)
}
