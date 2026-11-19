package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/checkpoint"
	"github.com/zasper-io/zasper/internal/httpx"
	"github.com/zasper-io/zasper/internal/secrets"
)

// Manager holds the project's chats, for as long as the server runs.
type Manager struct {
	root  string
	files Files
	// The MCP servers a chat's agent is given, so it has Zasper's notebook tools with no setup.
	tools func(chatID, agent string) []acp.McpServer
	// Where a key the reader gives an agent's sign-in is kept: the keychain, where there is one.
	secrets secrets.Store

	mu    sync.Mutex
	chats map[string]*Chat
}

// New hosts agents in the project at root.
func New(root string, files Files) *Manager {
	return &Manager{root: root, files: files, chats: map[string]*Chat{}, secrets: secrets.Default()}
}

// GiveTools sets the MCP servers each new chat's agent is given.
func (m *Manager) GiveTools(tools func(chatID, agent string) []acp.McpServer) {
	m.tools = tools
}

// Start starts an agent, the known one id or the custom command line, in a chat of its own. Cancelling
// ctx, as a reader who gives up on a slow start does, stops the agent before its session opens. With
// signInWith, a way the agent offered of signing itself in, it is signed in first, with key when the way
// takes one; that key is kept, and given back when the agent next asks to be signed in.
func (m *Manager) Start(ctx context.Context, id, custom, signInWith, key string) (*Chat, error) {
	argv, agent, ok := commandFor(id, custom)
	if !ok {
		analytics.Track(analytics.EventAgentStartFailed, map[string]interface{}{
			"agent": analytics.AgentKind(id), "reason": "not_installed",
		})
		return nil, fmt.Errorf("%q is not installed, or not an agent Zasper knows", id)
	}
	var servers []acp.McpServer
	if m.tools != nil {
		servers = m.tools("", agent)
	}
	signing := signingIn{With: signInWith, Key: key, KeyWays: keyWaysOf(agent)}
	if len(signing.KeyWays) > 0 {
		signing.Kept = func(way string) (string, bool) {
			kept, err := m.secrets.Get(keySecret(agent, way))
			return kept, err == nil && kept != ""
		}
	}
	chat, err := start(ctx, argv, agent, m.root, signing, m.files, servers, m.checkpoints())
	if err != nil {
		reason := "failed"
		var signIn *SignInRequired
		if ctx.Err() != nil {
			reason = "cancelled"
		} else if errors.As(err, &signIn) {
			reason = "sign_in"
		}
		analytics.Track(analytics.EventAgentStartFailed, map[string]interface{}{
			"agent": analytics.AgentKind(agent), "reason": reason,
		})
		return nil, err
	}
	if chat.keyed != "" {
		chat.KeptKey = chat.keyed
		if key != "" {
			if err := m.secrets.Set(keySecret(agent, signInWith), strings.TrimSpace(key)); err != nil {
				log.Warn().Err(err).Str("agent", agent).Msg("the agent's key could not be kept; the next chat asks for it again")
				chat.KeptKey = ""
			}
		}
	}
	analytics.Track(analytics.EventAgentChatStarted, map[string]interface{}{"agent": analytics.AgentKind(agent)})
	m.mu.Lock()
	m.chats[chat.ID] = chat
	m.mu.Unlock()
	return chat, nil
}

// keySecret names the key kept for one of an agent's ways of signing in.
func keySecret(agent, way string) string {
	return "agent-key:" + agent + ":" + way
}

// forgetKeys drops the keys kept for the agent's ways, as signing it out asks.
func (m *Manager) forgetKeys(agent string, ways []SignInMethod) {
	for _, way := range ways {
		if !way.TakesKey {
			continue
		}
		if err := m.secrets.Delete(keySecret(agent, way.ID)); err != nil && !errors.Is(err, secrets.ErrNotFound) {
			log.Warn().Err(err).Str("agent", agent).Msg("the agent's key could not be forgotten")
		}
	}
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
	// What a start answers, so that a panel opened again draws the chat as the one that started it did.
	type listed struct {
		ID         string         `json:"id"`
		Agent      string         `json:"agent"`
		Mode       string         `json:"mode"`
		History    bool           `json:"history"`
		CanSignOut bool           `json:"can_sign_out"`
		Steers     bool           `json:"steers"`
		SignInWays []SignInMethod `json:"sign_in_ways,omitempty"`
		KeptKey    string         `json:"kept_key,omitempty"`
	}
	m.mu.Lock()
	chats := make([]listed, 0, len(m.chats))
	for _, chat := range m.chats {
		chats = append(chats, listed{
			ID: chat.ID, Agent: chat.Agent, Mode: chat.mode(), History: chat.History,
			CanSignOut: chat.CanSignOut, Steers: chat.Steers, SignInWays: chat.SignInWays, KeptKey: chat.KeptKey,
		})
	}
	m.mu.Unlock()
	httpx.SendJSON(w, http.StatusOK, chats)
}

// StartHandler answers POST /api/agents/chats with {"agent"} or {"command"}, and {"sign_in"} to have the
// agent sign itself in first. A start refused for want of a sign-in answers 403 with the ways it offers.
func (m *Manager) StartHandler(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Agent   string `json:"agent"`
		Command string `json:"command"`
		// A way the agent offered of signing itself in, to carry out first, and the key it takes.
		SignIn string `json:"sign_in"`
		Key    string `json:"key"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}
	chat, err := m.Start(req.Context(), body.Agent, body.Command, body.SignIn, body.Key)
	var signIn *SignInRequired
	if errors.As(err, &signIn) {
		answer := map[string]any{"error": "sign_in_required", "message": err.Error(), "methods": signIn.Methods}
		if signIn.Refused != "" {
			answer["refused"] = signIn.Refused
		}
		httpx.SendJSON(w, http.StatusForbidden, answer)
		return
	}
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusCreated, chat)
}

// SignOutHandler answers POST /api/agents/chats/{chatId}/sign-out: the agent is signed out, everywhere
// it is used on this computer, and the answer is the ways it offers to be signed in again. The chat
// is left for the client to end.
func (m *Manager) SignOutHandler(w http.ResponseWriter, req *http.Request) {
	chat, ok := m.get(mux.Vars(req)["chatId"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "No such chat")
		return
	}
	methods, err := chat.SignOut()
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	m.forgetKeys(chat.Agent, methods)
	analytics.Track(analytics.EventAgentSignedOut, map[string]interface{}{"agent": analytics.AgentKind(chat.Agent)})
	httpx.SendJSON(w, http.StatusOK, map[string]any{"methods": methods})
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

// LoadHandler answers POST /api/agents/chats/{chatId}/load with {"id", "title"}: the chat goes on in that
// past conversation, headed by its title until the agent sends one. 409 while the agent is answering.
func (m *Manager) LoadHandler(w http.ResponseWriter, req *http.Request) {
	chat, ok := m.get(mux.Vars(req)["chatId"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "No such chat")
		return
	}
	var body struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.ID == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Name the conversation to open")
		return
	}
	if err := chat.Load(body.ID, body.Title); err != nil {
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

// UndoHandler answers POST /api/agents/chats/{chatId}/turns/{turn}/undo with {"anyway", "paths"}: the
// files the turn changed are put back, those at paths or else all of them. 409 with "changed" when some have changed since and anyway is not set.
func (m *Manager) UndoHandler(w http.ResponseWriter, req *http.Request) {
	chat, number, ok := m.chatTurn(w, req)
	if !ok {
		return
	}
	var body struct {
		Anyway bool     `json:"anyway"`
		Paths  []string `json:"paths"`
	}
	json.NewDecoder(req.Body).Decode(&body)
	err := chat.Undo(req.Context(), number, body.Anyway, body.Paths...)
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
happens. The client sends {"type": "prompt", "text", "mentions"}, {"type": "cancel"}, {"type": "answer", "id",
"option_id"}, {"type": "mode", "mode"}, or {"type": "setting", "id", "value"}; a message that cannot be carried
out is answered with an `error` event to that client.
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
			Type     string         `json:"type"`
			Text     string         `json:"text"`
			ID       string         `json:"id"`
			OptionID string         `json:"option_id"`
			Mode     string         `json:"mode"`
			Mentions []Mention      `json:"mentions"`
			Value    any            `json:"value"`
			Action   string         `json:"action"`
			Content  map[string]any `json:"content"`
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
		case "reply":
			err = chat.Reply(message.ID, message.Action, message.Content)
		case "mode":
			err = chat.SetMode(message.Mode)
		case "setting":
			// The agent may take its time, and the socket goes on carrying a Stop meanwhile.
			go func() {
				if err := chat.SetSetting(message.ID, message.Value); err != nil {
					send(Event{Type: "error", Text: err.Error()})
				}
			}()
		default:
			err = errors.New("unknown message " + message.Type)
		}
		if err != nil {
			log.Debug().Err(err).Str("chat", chat.ID).Msg("a chat message could not be carried out")
			send(Event{Type: "error", Text: err.Error()})
		}
	}
}
