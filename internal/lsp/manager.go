package lsp

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/config"
	"github.com/zasper-io/zasper/internal/httpx"
)

// Close codes the frontend reads to tell a server that is missing from one that failed.
const (
	closeTurnedOff    = 4001
	closeNotInstalled = 4002
	closeExited       = 4003
)

// How much of a server's standard error is kept for Show log.
const maxLog = 256 << 10

// How long a server is given to exit on its own once its connection has gone, before it is killed.
const exitGrace = 2 * time.Second

var upgrader = websocket.Upgrader{
	ReadBufferSize:  32 << 10,
	WriteBufferSize: 32 << 10,
	CheckOrigin:     httpx.SameOrigin,
}

// logBuffer keeps the end of what a language's servers have written to standard error.
type logBuffer struct {
	mu   sync.Mutex
	data []byte
}

func (b *logBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.data = append(b.data, p...)
	if len(b.data) > maxLog {
		b.data = b.data[len(b.data)-maxLog:]
	}
	return len(p), nil
}

func (b *logBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(b.data)
}

// Manager starts language servers for one project.
type Manager struct {
	finder   finder
	settings func() config.LanguageServerSettings

	mu      sync.Mutex
	running map[*exec.Cmd]struct{}
	logs    map[string]*logBuffer
}

// New answers a manager for the project at root.
func New(root string) *Manager {
	home, _ := os.UserHomeDir()
	return &Manager{
		finder:   finder{root: root, home: home, lookPath: exec.LookPath},
		settings: config.GetLanguageServerSettings,
		running:  map[*exec.Cmd]struct{}{},
		logs:     map[string]*logBuffer{},
	}
}

func (m *Manager) logFor(language string) *logBuffer {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.logs[language] == nil {
		m.logs[language] = &logBuffer{}
	}
	return m.logs[language]
}

// ServerList is what Settings and the status bar are told about every language.
type ServerList struct {
	Enabled bool       `json:"enabled"`
	Servers []Resolved `json:"servers"`
}

// Servers answers, for every language, which server would be started and whether it is installed.
func (m *Manager) Servers(w http.ResponseWriter, r *http.Request) {
	settings := m.settings()
	list := ServerList{Enabled: !settings.Disabled, Servers: []Resolved{}}
	for _, language := range Languages {
		list.Servers = append(list.Servers, m.finder.resolve(language, settings))
	}
	httpx.SendJSON(w, http.StatusOK, list)
}

// Log answers what a language's servers have written to standard error, oldest first.
func (m *Manager) Log(w http.ResponseWriter, r *http.Request) {
	language := r.URL.Query().Get("language")
	if _, ok := languageByID(language); !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("there is no language called %q", language))
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, m.logFor(language).String())
}

func closeWith(conn *websocket.Conn, code int, reason string) {
	if len(reason) > 120 {
		reason = reason[:120]
	}
	_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason), time.Now().Add(time.Second))
}

/*
HandleWebSocket starts the server for a language and passes messages both ways until one side ends: the
browser closing the socket stops the server, and the server exiting closes the socket with closeExited.
*/
func (m *Manager) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	language, ok := languageByID(mux.Vars(r)["language"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "there is no such language")
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Debug().Err(err).Msg("language server socket was not upgraded")
		return
	}
	defer conn.Close()
	conn.SetReadLimit(maxMessage)

	settings := m.settings()
	if settings.Disabled {
		closeWith(conn, closeTurnedOff, "Language servers are turned off in Settings.")
		return
	}
	resolved := m.finder.resolve(language, settings)
	if !resolved.Found {
		closeWith(conn, closeNotInstalled, resolved.Server+" is not installed.")
		return
	}

	logs := m.logFor(language.ID)
	fmt.Fprintf(logs, "[zasper] starting %s\n", strings.Join(resolved.argv, " "))

	cmd := exec.Command(resolved.argv[0], resolved.argv[1:]...)
	cmd.Dir = m.finder.root
	cmd.Env = m.finder.env()
	cmd.Stderr = logs
	stdin, err := cmd.StdinPipe()
	if err != nil {
		closeWith(conn, closeExited, err.Error())
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		closeWith(conn, closeExited, err.Error())
		return
	}
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(logs, "[zasper] could not start: %v\n", err)
		closeWith(conn, closeExited, "could not start: "+err.Error())
		return
	}
	m.track(cmd, true)
	defer m.track(cmd, false)
	log.Debug().Str("language", language.ID).Str("server", resolved.Server).Msg("started a language server")

	var writeMu sync.Mutex
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	// Server to browser.
	serverDone := make(chan struct{})
	go func() {
		defer close(serverDone)
		reader := bufio.NewReaderSize(stdout, 64<<10)
		for {
			body, err := readMessage(reader)
			if err != nil {
				if !errors.Is(err, io.EOF) && !errors.Is(err, os.ErrClosed) {
					fmt.Fprintf(logs, "[zasper] unreadable output: %v\n", err)
				}
				return
			}
			writeMu.Lock()
			err = conn.WriteMessage(websocket.TextMessage, body)
			writeMu.Unlock()
			if err != nil {
				return
			}
		}
	}()

	// Browser to server, until the browser goes.
	browserDone := make(chan struct{})
	go func() {
		defer close(browserDone)
		for {
			_, body, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if err := writeMessage(stdin, body); err != nil {
				return
			}
		}
	}()

	select {
	case <-browserDone:
		// Closing standard input is how a server hears its client has gone; one that does not exit is killed.
		stdin.Close()
		select {
		case err := <-exited:
			fmt.Fprintf(logs, "[zasper] stopped: %v\n", describeExit(err))
		case <-time.After(exitGrace):
			_ = cmd.Process.Kill()
			fmt.Fprintf(logs, "[zasper] killed: %v\n", describeExit(<-exited))
		}
	case err := <-exited:
		<-serverDone
		reason := describeExit(err)
		fmt.Fprintf(logs, "[zasper] exited: %s\n", reason)
		writeMu.Lock()
		closeWith(conn, closeExited, resolved.Server+" exited: "+reason)
		writeMu.Unlock()
	}
	log.Debug().Str("language", language.ID).Msg("stopped a language server")
}

func describeExit(err error) string {
	if err == nil {
		return "exit status 0"
	}
	return err.Error()
}

func (m *Manager) track(cmd *exec.Cmd, running bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if running {
		m.running[cmd] = struct{}{}
	} else {
		delete(m.running, cmd)
	}
}

// Running answers how many servers are running, for tests and for shutdown.
func (m *Manager) Running() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.running)
}

// StopAll kills every server this manager started.
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for cmd := range m.running {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}
}
