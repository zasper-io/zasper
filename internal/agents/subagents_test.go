package agents

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func subagentEvents(events []Event) []Subagent {
	var found []Subagent
	for _, event := range events {
		if event.Type == "subagent" {
			found = append(found, *event.Subagent)
		}
	}
	return found
}

// OpenCode's subagent goes on after the turn that started it, and the agent takes the conversation up again.
func TestASubagentsWorkIsLoggedAfterTheTurnThatStartedIt(t *testing.T) {
	t.Setenv("ZASPER_FAKE_AGENT_OPENCODE", "1")
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("subagent"))
	waitFor(t, chat, turnEnded)
	events := waitFor(t, chat, saidSoFar("The subagent found one call"))

	found := subagentEvents(events)
	require.Len(t, found, 3)
	assert.Equal(t, []string{"created", "running", "completed"}, []string{found[0].Status, found[1].Status, found[2].Status})
	assert.Equal(t, "ses_fakechild", found[0].ID)
	assert.Equal(t, "Find greet calls", found[0].Title)
	assert.Equal(t, 1, found[0].Depth)

	var kinds []string
	for _, event := range events {
		if event.Type != "update" {
			continue
		}
		var update struct {
			SessionUpdate string         `json:"sessionUpdate"`
			Meta          map[string]any `json:"_meta"`
		}
		require.NoError(t, json.Unmarshal(event.Update, &update))
		if update.Meta["opencode/child-session"] != nil {
			kinds = append(kinds, update.SessionUpdate)
		}
	}
	// Its usage is its own session's, not the chat's: left out.
	assert.Equal(t, []string{"agent_message_chunk", "tool_call", "tool_call_update", "tool_call_update", "agent_message_chunk"}, kinds)
}

func TestAnErrorIsReadAsTextOrFromItsMessage(t *testing.T) {
	assert.Equal(t, "", errorText(nil))
	assert.Equal(t, "", errorText(json.RawMessage("null")))
	assert.Equal(t, "boom", errorText(json.RawMessage(`"boom"`)))
	assert.Equal(t, "no model", errorText(json.RawMessage(`{"name": "ProviderError", "message": "no model"}`)))
	assert.Equal(t, "rate limited", errorText(json.RawMessage(`{"name": "APIError", "data": {"message": "rate limited"}}`)))
	assert.Equal(t, `{"name":"Unknown"}`, errorText(json.RawMessage(`{"name":"Unknown"}`)))
}
