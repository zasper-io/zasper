package agents

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"sync"

	acp "github.com/coder/acp-go-sdk"
)

/*
The agent's own pipes, read and written beside the SDK rather than through it, for two things it cannot
do.

What the agent streams is logged as the agent sent it. The SDK decodes an update of a kind it does not
know (Claude Code's compaction_update, notice, subagent_spawned) as an empty session_info_update, so
everything an agent adds beyond the kinds in ACP's schema would be lost before the log.

And the client capabilities that ask for those kinds are added to `initialize`: the SDK's
ClientCapabilities has no field for them, and without them an agent falls back to drawing them as tool
calls and text.
*/

// The capabilities under `session` that Zasper draws and the SDK cannot say.
var sessionCapabilities = map[string]any{
	"compaction":    map[string]any{},
	"notices":       map[string]any{},
	"configOptions": map[string]any{"boolean": map[string]any{}},
}

// tapUpdates passes what the agent writes on to the SDK, logging each session/update on the way.
func (c *Chat) tapUpdates(from io.Reader) io.Reader {
	out, in := io.Pipe()
	go func() {
		lines := bufio.NewReaderSize(from, 64<<10)
		for {
			line, err := lines.ReadBytes('\n')
			if len(line) > 0 && c.noteAccount(line) {
				// Not the SDK's to answer: it knows no such method, and says so in the log.
				continue
			}
			if len(line) > 0 {
				c.noteUpdate(line)
				if _, failed := in.Write(line); failed != nil {
					return
				}
			}
			if err != nil {
				in.CloseWithError(err)
				return
			}
		}
	}()
	return out
}

/*
noteAccount logs who the agent says it is signed in as, when the line says, and answers whether it was
such a line. Claude Code sends `auth/status_update` (and its own `_auth/status_update`, which says the
same) whenever that changes. The active account's label is kept, such as the plan; its address is not.
*/
func (c *Chat) noteAccount(line []byte) bool {
	var message struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Params struct {
			State    string `json:"state"`
			Accounts []struct {
				Label  string `json:"label"`
				Active bool   `json:"active"`
			} `json:"accounts"`
		} `json:"params"`
	}
	if json.Unmarshal(line, &message) != nil || len(message.ID) > 0 {
		return false
	}
	switch message.Method {
	case "_auth/status_update":
		return true
	case "auth/status_update":
	default:
		return false
	}
	account := Account{SignedIn: message.Params.State == "authenticated"}
	for _, each := range message.Params.Accounts {
		if each.Active || account.Label == "" {
			account.Label = each.Label
		}
	}
	if !account.SignedIn {
		account.Label = ""
	}
	c.record(Event{Type: "account", Account: &account})
	return true
}

// noteUpdate logs the update in a line from the agent, when the line is one. Settings change the chat
// rather than going in the log as an update.
func (c *Chat) noteUpdate(line []byte) {
	var message struct {
		Method string `json:"method"`
		Params struct {
			Update json.RawMessage `json:"update"`
		} `json:"params"`
	}
	if json.Unmarshal(line, &message) != nil || message.Method != acp.ClientMethodSessionUpdate || len(message.Params.Update) == 0 {
		return
	}
	var kind struct {
		SessionUpdate string `json:"sessionUpdate"`
	}
	json.Unmarshal(message.Params.Update, &kind)
	if kind.SessionUpdate == "session_info_update" {
		var info struct {
			Title *string `json:"title"`
		}
		if json.Unmarshal(message.Params.Update, &info) == nil && info.Title != nil {
			c.mu.Lock()
			c.title = *info.Title
			c.mu.Unlock()
		}
	}
	if kind.SessionUpdate == "config_option_update" {
		var settings acp.SessionConfigOptionUpdate
		if json.Unmarshal(message.Params.Update, &settings) == nil {
			c.setSettings(settings.ConfigOptions)
		}
		return
	}
	var update bytes.Buffer
	if json.Compact(&update, message.Params.Update) != nil {
		return
	}
	c.record(Event{Type: "update", Update: update.Bytes()})
}

// advertise writes to the agent, adding Zasper's session capabilities to the `initialize` request.
func advertise(to io.Writer) io.Writer {
	return &advertising{to: to}
}

type advertising struct {
	mu      sync.Mutex
	to      io.Writer
	pending []byte
	done    bool
}

func (a *advertising) Write(p []byte) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.done {
		return a.to.Write(p)
	}
	a.pending = append(a.pending, p...)
	for !a.done {
		end := bytes.IndexByte(a.pending, '\n')
		if end < 0 {
			return len(p), nil
		}
		line := a.pending[:end+1]
		if rewritten, ok := withCapabilities(line); ok {
			line = rewritten
			a.done = true
		}
		if _, err := a.to.Write(line); err != nil {
			return 0, err
		}
		a.pending = a.pending[end+1:]
	}
	if len(a.pending) > 0 {
		rest := a.pending
		a.pending = nil
		if _, err := a.to.Write(rest); err != nil {
			return 0, err
		}
	}
	return len(p), nil
}

// withCapabilities is the `initialize` request in line with Zasper's session capabilities added, or
// false for any other line.
func withCapabilities(line []byte) ([]byte, bool) {
	var request map[string]any
	if json.Unmarshal(line, &request) != nil || request["method"] != acp.AgentMethodInitialize {
		return nil, false
	}
	params, _ := request["params"].(map[string]any)
	if params == nil {
		return nil, false
	}
	capabilities, _ := params["clientCapabilities"].(map[string]any)
	if capabilities == nil {
		capabilities = map[string]any{}
		params["clientCapabilities"] = capabilities
	}
	session, _ := capabilities["session"].(map[string]any)
	if session == nil {
		session = map[string]any{}
		capabilities["session"] = session
	}
	for name, value := range sessionCapabilities {
		if _, ok := session[name]; !ok {
			session[name] = value
		}
	}
	rewritten, err := json.Marshal(request)
	if err != nil {
		return nil, false
	}
	return append(rewritten, '\n'), true
}
