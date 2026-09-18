package lsp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/config"
)

/*
TestHelperServer is not a test: it is the language server the tests start, this test binary run again with
ZASPER_LSP_TEST_SERVER set. It answers every message with the message wrapped in {"echo": …}, says hello
on standard error, and exits when a message asks it to.
*/
func TestHelperServer(t *testing.T) {
	if os.Getenv("ZASPER_LSP_TEST_SERVER") != "1" {
		return
	}
	os.Stderr.WriteString("hello from the server\n")
	reader := bufio.NewReader(os.Stdin)
	for {
		body, err := readMessage(reader)
		if err != nil {
			os.Exit(0)
		}
		if bytes.Contains(body, []byte(`"exit"`)) {
			os.Exit(3)
		}
		_ = writeMessage(os.Stdout, []byte(`{"echo":`+string(body)+`}`))
	}
}

func noPath(string) (string, error) { return "", errors.New("not on PATH") }

func TestAMessageSurvivesTheFramingBothWays(t *testing.T) {
	var buffer bytes.Buffer
	require.NoError(t, writeMessage(&buffer, []byte(`{"id":1,"method":"initialize"}`)))
	require.NoError(t, writeMessage(&buffer, []byte(`{"id":2}`)))

	reader := bufio.NewReader(&buffer)
	first, err := readMessage(reader)
	require.NoError(t, err)
	second, err := readMessage(reader)
	require.NoError(t, err)

	assert.Equal(t, `{"id":1,"method":"initialize"}`, string(first))
	assert.Equal(t, `{"id":2}`, string(second))
}

func TestAMessageWithoutALengthIsRefused(t *testing.T) {
	_, err := readMessage(bufio.NewReader(strings.NewReader("Content-Type: x\r\n\r\n{}")))
	assert.Error(t, err)

	_, err = readMessage(bufio.NewReader(strings.NewReader("Content-Length: nope\r\n\r\n{}")))
	assert.Error(t, err)
}

func TestACommandIsSplitTheWayAShellWouldSplitIt(t *testing.T) {
	assert.Equal(t, []string{"julia", "-e", "using LanguageServer; runserver()"}, splitCommand(`julia -e "using LanguageServer; runserver()"`))
	assert.Equal(t, []string{"a b", "c"}, splitCommand(`'a b'   c`))
	assert.Equal(t, []string{}, splitCommand("   "))
}

// executableIn makes a program exec.LookPath accepts, which on Windows means one with an extension on
// PATHEXT.
func executableIn(t *testing.T, folder, name string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	require.NoError(t, os.MkdirAll(folder, 0o755))
	path := filepath.Join(folder, name)
	require.NoError(t, os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755))
	return path
}

// gopls in ~/go/bin is not on the PATH a desktop launcher gives, and is still found.
func TestAServerIsFoundWhereItIsInstalledWithoutPATH(t *testing.T) {
	home := t.TempDir()
	gopls := executableIn(t, filepath.Join(home, "go", "bin"), "gopls")
	f := finder{root: t.TempDir(), home: home, lookPath: noPath}

	resolved := f.resolve(Languages[0], config.LanguageServerSettings{})

	assert.True(t, resolved.Found)
	assert.Equal(t, gopls, resolved.Path)
	assert.Equal(t, "gopls", resolved.Server)
}

func TestAMissingServerSaysWhatToInstall(t *testing.T) {
	f := finder{root: t.TempDir(), home: t.TempDir(), lookPath: noPath}
	python, _ := languageByID("python")

	resolved := f.resolve(python, config.LanguageServerSettings{})

	assert.False(t, resolved.Found)
	assert.Equal(t, "basedpyright", resolved.Server)
	assert.Equal(t, "pip install basedpyright", resolved.Install)
}

func TestAProjectsOwnVirtualEnvironmentServesItsPython(t *testing.T) {
	root := t.TempDir()
	pylsp := executableIn(t, filepath.Join(root, ".venv", venvPrograms()), "pylsp")
	f := finder{root: root, home: t.TempDir(), lookPath: noPath}
	python, _ := languageByID("python")

	resolved := f.resolve(python, config.LanguageServerSettings{})

	assert.Equal(t, "pylsp", resolved.Server)
	assert.Equal(t, pylsp, resolved.Path)
}

func TestAConfiguredCommandWins(t *testing.T) {
	home := t.TempDir()
	executableIn(t, filepath.Join(home, "go", "bin"), "gopls")
	custom := executableIn(t, t.TempDir(), "my-gopls")
	f := finder{root: t.TempDir(), home: home, lookPath: noPath}

	resolved := f.resolve(Languages[0], config.LanguageServerSettings{Commands: map[string]string{"go": custom + " -remote=auto"}})

	assert.True(t, resolved.Configured)
	assert.Equal(t, "my-gopls", resolved.Server)
	assert.Equal(t, []string{custom, "-remote=auto"}, resolved.argv)
}

// testManager answers a manager whose Go server is this test binary acting as TestHelperServer.
func testManager(t *testing.T, settings config.LanguageServerSettings) (*Manager, *httptest.Server) {
	t.Helper()
	m := New(t.TempDir())
	// Nowhere but the folders this test made: the machine running it has servers installed in the
	// places discovery searches, and "no server for Python" has to mean that here.
	m.finder.lookPath = noPath
	m.finder.home = t.TempDir()
	m.finder.gopath = ""
	m.finder.system = nil
	m.settings = func() config.LanguageServerSettings { return settings }

	router := mux.NewRouter()
	router.HandleFunc("/ws/lsp/{language}", m.HandleWebSocket)
	router.HandleFunc("/api/lsp/servers", m.Servers)
	router.HandleFunc("/api/lsp/log", m.Log)
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	return m, server
}

func helperSettings() config.LanguageServerSettings {
	return config.LanguageServerSettings{Commands: map[string]string{
		"go": os.Args[0] + " -test.run=^TestHelperServer$",
	}}
}

func dial(t *testing.T, server *httptest.Server, language string) *websocket.Conn {
	t.Helper()
	t.Setenv("ZASPER_LSP_TEST_SERVER", "1")
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/lsp/" + language
	header := http.Header{"Origin": []string{server.URL}}
	conn, _, err := websocket.DefaultDialer.Dial(url, header)
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	return conn
}

func TestMessagesPassBetweenTheBrowserAndTheServer(t *testing.T) {
	m, server := testManager(t, helperSettings())
	conn := dial(t, server, "go")

	require.NoError(t, conn.WriteMessage(websocket.TextMessage, []byte(`{"id":1,"method":"initialize"}`)))
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, answer, err := conn.ReadMessage()
	require.NoError(t, err)

	assert.JSONEq(t, `{"echo":{"id":1,"method":"initialize"}}`, string(answer))
	assert.Equal(t, 1, m.Running())

	// The browser going stops the server.
	conn.Close()
	assert.Eventually(t, func() bool { return m.Running() == 0 }, 5*time.Second, 20*time.Millisecond)
	assert.Contains(t, m.logFor("go").String(), "hello from the server")
}

func TestAServerThatExitsClosesTheSocketSayingSo(t *testing.T) {
	_, server := testManager(t, helperSettings())
	conn := dial(t, server, "go")

	require.NoError(t, conn.WriteMessage(websocket.TextMessage, []byte(`{"method":"exit"}`)))
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, _, err := conn.ReadMessage()

	var closed *websocket.CloseError
	require.ErrorAs(t, err, &closed)
	assert.Equal(t, closeExited, closed.Code)
	assert.Contains(t, closed.Text, "exit status 3")
}

func TestAMissingServerOrServersTurnedOffCloseTheSocketSayingWhich(t *testing.T) {
	_, server := testManager(t, config.LanguageServerSettings{})
	conn := dial(t, server, "python")
	_, _, err := conn.ReadMessage()
	var closed *websocket.CloseError
	require.ErrorAs(t, err, &closed)
	assert.Equal(t, closeNotInstalled, closed.Code)

	_, off := testManager(t, config.LanguageServerSettings{Disabled: true})
	conn = dial(t, off, "go")
	_, _, err = conn.ReadMessage()
	require.ErrorAs(t, err, &closed)
	assert.Equal(t, closeTurnedOff, closed.Code)
}

func TestTheServerListSaysWhatWouldStartForEveryLanguage(t *testing.T) {
	_, server := testManager(t, helperSettings())

	answer, err := http.Get(server.URL + "/api/lsp/servers")
	require.NoError(t, err)
	defer answer.Body.Close()
	var list ServerList
	require.NoError(t, json.NewDecoder(answer.Body).Decode(&list))

	assert.True(t, list.Enabled)
	require.Len(t, list.Servers, len(Languages))
	assert.True(t, list.Servers[0].Configured)
	assert.True(t, list.Servers[0].Found)

	unknown, err := http.Get(server.URL + "/api/lsp/log?language=cobol")
	require.NoError(t, err)
	unknown.Body.Close()
	assert.Equal(t, http.StatusNotFound, unknown.StatusCode)
}

// Julia is found by its runtime, which serves nothing without the package, and the list says so.
func TestAServerInsideARuntimeSaysWhatItNeeds(t *testing.T) {
	home := t.TempDir()
	executableIn(t, filepath.Join(home, ".juliaup", "bin"), "julia")
	f := finder{root: t.TempDir(), home: home, lookPath: noPath}
	julia, _ := languageByID("julia")

	resolved := f.resolve(julia, config.LanguageServerSettings{})

	assert.True(t, resolved.Found)
	assert.Equal(t, "julia", resolved.Program)
	assert.Equal(t, "the LanguageServer.jl package", resolved.Needs)
}
