package agents

import (
	"bytes"
	"encoding/json"
)

/*
OpenCode hands a task to a subagent, which works in a session of its own and in the background: the call
that starts it answers at once, the turn ends, and the subagent goes on. Asked for with
`_meta["opencode/child-session-updates"]` in `initialize`, OpenCode sends all a subagent does as an
`opencode/session/child_update` notification, whether or not a prompt is being answered: its status, or
one of its updates as ACP's, marked with `_meta["opencode/child-session"]`. Without asking, it sends them
only while the prompt that started it is open.
*/
const childUpdateMethod = "opencode/session/child_update"

// childUpdates asks OpenCode for every subagent's work, in `initialize`'s client capabilities.
const childUpdates = "opencode/child-session-updates"

// Subagent is a session an agent started to work on a task of its own, as it last reported it.
type Subagent struct {
	ID string `json:"id"`
	// The session that started it: the chat's own, or another subagent's.
	Parent string `json:"parent,omitempty"`
	// Its task, as the call that started it describes it.
	Title string `json:"title,omitempty"`
	Depth int    `json:"depth,omitempty"`
	// created, running, completed, failed or interrupted.
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// What a subagent says and does, which is the conversation's; its title, settings, usage and plan are not.
var childKinds = map[string]bool{
	"agent_message_chunk": true,
	"agent_thought_chunk": true,
	"tool_call":           true,
	"tool_call_update":    true,
}

// noteChild logs a subagent's status or update, when the line is one, and answers whether it was.
func (c *Chat) noteChild(line []byte) bool {
	var message struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Params struct {
			ChildSessionID  string          `json:"childSessionId"`
			ParentSessionID string          `json:"parentSessionId"`
			Depth           int             `json:"depth"`
			Title           string          `json:"title"`
			Type            string          `json:"type"`
			Status          string          `json:"status"`
			Error           json.RawMessage `json:"error"`
			Update          json.RawMessage `json:"update"`
		} `json:"params"`
	}
	if json.Unmarshal(line, &message) != nil || len(message.ID) > 0 || message.Method != childUpdateMethod {
		return false
	}
	params := message.Params
	switch params.Type {
	case "status":
		c.record(Event{Type: "subagent", Subagent: &Subagent{
			ID:     params.ChildSessionID,
			Parent: params.ParentSessionID,
			Title:  params.Title,
			Depth:  params.Depth,
			Status: params.Status,
			Error:  errorText(params.Error),
		}})
	case "update":
		var kind struct {
			SessionUpdate string `json:"sessionUpdate"`
		}
		var update bytes.Buffer
		if json.Unmarshal(params.Update, &kind) == nil && childKinds[kind.SessionUpdate] &&
			json.Compact(&update, params.Update) == nil {
			c.record(Event{Type: "update", Update: update.Bytes()})
		}
	}
	return true
}

// errorText is what an error says, sent as text or as an object with a message.
func errorText(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var described struct {
		Message string `json:"message"`
		Data    struct {
			Message string `json:"message"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &described) == nil {
		if described.Message != "" {
			return described.Message
		}
		if described.Data.Message != "" {
			return described.Data.Message
		}
	}
	return string(raw)
}
