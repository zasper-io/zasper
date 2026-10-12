package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/checkpoint"
	"github.com/zasper-io/zasper/internal/httpx"
)

// Manager holds the project's chats, for as long as the server runs.
type Manager struct {
	root  string
	files Files
	// The MCP servers a chat's agent is given, so it has Zasper's notebook tools with no setup.
	tools func(chatID, agent string) []acp.McpServer

	mu    sync.Mutex
	chats map[string]*Chat
}

// New hosts agents in the project at root.
func New(root string, files Files) *Manager {
	return &Manager{root: root, files: files, chats: map[string]*Chat{}}
}

// GiveTools sets the MCP servers each new chat's agent is given.
func (m *Manager) GiveTools(tools func(chatID, agent string) []acp.McpServer) {
	m.tools = tools
}

// Start starts an agent, the known one id or the custom command line, in a chat of its own. Cancelling
// ctx, as a reader who gives up on a slow start does, stops the agent before its session opens.
func (m *Manager) Start(ctx context.Context, id, custom string) (*Chat, error) {
	argv, agent, ok := commandFor(id, custom)
	if !ok {
		return nil, fmt.Errorf("%q is not installed, or not an agent Zasper knows", id)
	}
	var servers []acp.McpServer
	if m.tools != nil {
		servers = m.tools("", agent)
	}
	chat, err := start(ctx, argv, agent, m.root, m.files, servers, m.checkpoints())
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.chats[chat.ID] = chat
	m.mu.Unlock()
	return chat, nil
}

func (m *Manager) get(id string) (*Chat, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	chat, ok := m.chats[id]
	return chat, ok
}

// checkpoints is the project's snapshots, or nil without git: a turn's changes are then not recorded.
func (m *Manager) checkpoints() *checkpoint.Store {
	store, err := checkpoint.For(m.root)
	if err != nil {
		log.Warn().Err(err).Msg("a turn's changes will not be recorded")
		return nil
	}
	return store
}

// Stop ends a chat and its agent.
func (m *Manager) Stop(id string) bool {
	m.mu.Lock()
	chat, ok := m.chats[id]
	delete(m.chats, id)
	m.mu.Unlock()
	if ok {
		chat.close()
	}
	return ok
}

// StopAll ends every chat, as the server stops.
func (m *Manager) StopAll() {
	m.mu.Lock()
	chats := m.chats
	m.chats = map[string]*Chat{}
	m.mu.Unlock()
	var stopping sync.WaitGroup
	for _, chat := range chats {
		stopping.Add(1)
		go func() {
			defer stopping.Done()
			chat.close()
		}()
	}
	stopping.Wait()
}

// CatalogueHandler answers GET /api/agents: the agents Zasper knows, and which are installed.
func (m *Manager) CatalogueHandler(w http.ResponseWriter, _ *http.Request) {
	httpx.SendJSON(w, http.StatusOK, Catalogue())
}

// ListHandler answers GET /api/agents/chats.
func (m *Manager) ListHandler(w http.ResponseWriter, _ *http.Request) {
	type listed struct {
		ID      string `json:"id"`
		Agent   string `json:"agent"`
		Mode    string `json:"mode"`
		History bool   `json:"history"`
	}
	m.mu.Lock()
	chats := make([]listed, 0, len(m.chats))
	for _, chat := range m.chats {
		chats = append(chats, listed{ID: chat.ID, Agent: chat.Agent, Mode: chat.mode(), History: chat.History})
	}
	m.mu.Unlock()
	httpx.SendJSON(w, http.StatusOK, chats)
}

// StartHandler answers POST /api/agents/chats with {"agent"} or {"command"}.
func (m *Manager) StartHandler(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Agent   string `json:"agent"`
		Command string `json:"command"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}
	chat, err := m.Start(req.Context(), body.Agent, body.Command)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusCreated, chat)
}

// StopHandler answers DELETE /api/agents/chats/{chatId}.
func (m *Manager) StopHandler(w http.ResponseWriter, req *http.Request) {
	if !m.Stop(mux.Vars(req)["chatId"]) {
		httpx.SendErrorResponse(w, http.StatusNotFound, "No such chat")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HistoryHandler answers GET /api/agents/chats/{chatId}/history?cursor=: a page of the agent's past
// conversations in the project, and the cursor of the next.
func (m *Manager) HistoryHandler(w http.ResponseWriter, req *http.Request) {
	chat, ok := m.get(mux.Vars(req)["chatId"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "No such chat")
		return
	}
	past, next, err := chat.Past(req.Context(), req.URL.Query().Get("cursor"))
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, map[string]any{"chats": past, "next": next})
}

// LoadHandler answers POST /api/agents/chats/{chatId}/load with {"id"}: the chat goes on in that past
// conversation. 409 while the agent is answering.
func (m *Manager) LoadHandler(w http.ResponseWriter, req *http.Request) {
	chat, ok := m.get(mux.Vars(req)["chatId"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "No such chat")
		return
	}
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.ID == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Name the conversation to open")
		return
	}
	if err := chat.Load(body.ID); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, ErrBusy) {
			status = http.StatusConflict
		}
		httpx.SendErrorResponse(w, status, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DiffHandler answers GET /api/agents/chats/{chatId}/turns/{turn}/diff?path=: one file a turn changed,
// before the turn and after it, in the shape of a git diff.
func (m *Manager) DiffHandler(w http.ResponseWriter, req *http.Request) {
	chat, number, ok := m.chatTurn(w, req)
	if !ok {
		return
	}
	diff, err := chat.Diff(req.Context(), number, req.URL.Query().Get("path"))
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusNotFound, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, diff)
}

// UndoHandler answers POST /api/agents/chats/{chatId}/turns/{turn}/undo with {"anyway"}: the files the
// turn changed are put back. 409 with "changed" when some have changed since and anyway is not set.
func (m *Manager) UndoHandler(w http.ResponseWriter, req *http.Request) {
	chat, number, ok := m.chatTurn(w, req)
	if !ok {
		return
	}
	var body struct {
		Anyway bool `json:"anyway"`
	}
	json.NewDecoder(req.Body).Decode(&body)
	err := chat.Undo(req.Context(), number, body.Anyway)
	var since *ChangedSince
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.As(err, &since):
		httpx.SendJSON(w, http.StatusConflict, map[string]any{"error": "changed", "message": err.Error(), "changed": since.Paths})
	case errors.Is(err, ErrBusy):
		httpx.SendErrorResponse(w, http.StatusConflict, err.Error())
	default:
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
	}
}

func (m *Manager) chatTurn(w http.ResponseWriter, req *http.Request) (*Chat, int, bool) {
	chat, ok := m.get(mux.Vars(req)["chatId"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "No such chat")
		return nil, 0, false
	}
	number, err := strconv.Atoi(mux.Vars(req)["turn"])
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "No such turn")
		return nil, 0, false
	}
	return chat, number, true
}

// How long a chat's socket may take to take a message before the client is taken to have stalled.
const writeTimeout = 10 * time.Second

var upgrader = websocket.Upgrader{CheckOrigin: httpx.SameOrigin}

/*
SocketHandler serves /ws/agents/chats/{chatId}: the chat's log from the start, then each event as it
happens. The client sends {"type": "prompt", "text", "mentions"}, {"type": "cancel"}, or {"type": "answer", "id",
"option_id"}; a message that cannot be carried out is answered with an `error` event to that client.
*/
func (m *Manager) SocketHandler(w http.ResponseWriter, req *http.Request) {
	chat, ok := m.get(mux.Vars(req)["chatId"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "No such chat")
		return
	}
	conn, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	events, updates, unsubscribe := chat.Subscribe()
	defer unsubscribe()
	var writing sync.Mutex
	send := func(event Event) error {
		writing.Lock()
		defer writing.Unlock()
		conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		return conn.WriteJSON(event)
	}
	for _, event := range events {
		if send(event) != nil {
			return
		}
	}
	go func() {
		for event := range updates {
			if send(event) != nil {
				conn.Close()
				return
			}
		}
		// Fell behind: closing makes the client reconnect and be sent the whole log again.
		conn.Close()
	}()

	for {
		var message struct {
			Type     string    `json:"type"`
			Text     string    `json:"text"`
			ID       string    `json:"id"`
			OptionID string    `json:"option_id"`
			Mode     string    `json:"mode"`
			Mentions []Mention `json:"mentions"`
		}
		if err := conn.ReadJSON(&message); err != nil {
			return
		}
		var err error
		switch message.Type {
		case "prompt":
			err = chat.Prompt(message.Text, message.Mentions...)
		case "cancel":
			err = chat.Cancel()
		case "answer":
			err = chat.Answer(message.ID, message.OptionID)
		case "mode":
			err = chat.SetMode(message.Mode)
		default:
			err = errors.New("unknown message " + message.Type)
		}
		if err != nil {
			log.Debug().Err(err).Str("chat", chat.ID).Msg("a chat message could not be carried out")
			send(Event{Type: "error", Text: err.Error()})
		}
	}
}
