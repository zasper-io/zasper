package agents

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInitializeAsksForWhatZasperDraws(t *testing.T) {
	line := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"terminal":true,"session":{"notices":{"x":1}}}}}` + "\n")

	rewritten, ok := withCapabilities(line)

	require.True(t, ok)
	var request struct {
		ID     int `json:"id"`
		Params struct {
			ProtocolVersion    int `json:"protocolVersion"`
			ClientCapabilities struct {
				Terminal bool                       `json:"terminal"`
				Session  map[string]json.RawMessage `json:"session"`
			} `json:"clientCapabilities"`
		} `json:"params"`
	}
	require.NoError(t, json.Unmarshal(rewritten, &request))
	assert.Equal(t, 1, request.ID)
	assert.Equal(t, 1, request.Params.ProtocolVersion)
	assert.True(t, request.Params.ClientCapabilities.Terminal)
	session := request.Params.ClientCapabilities.Session
	assert.JSONEq(t, `{}`, string(session["compaction"]))
	assert.JSONEq(t, `{"x":1}`, string(session["notices"]), "what the client said already stands")
	assert.JSONEq(t, `{"boolean":{}}`, string(session["configOptions"]))
	assert.True(t, bytes.HasSuffix(rewritten, []byte("\n")))

	_, ok = withCapabilities([]byte(`{"jsonrpc":"2.0","id":2,"method":"session/new","params":{}}` + "\n"))
	assert.False(t, ok)
}

func TestTheInitializeRequestIsRewrittenHoweverItIsWritten(t *testing.T) {
	var out bytes.Buffer
	to := advertise(&out)
	initialize := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}` + "\n"
	after := `{"jsonrpc":"2.0","id":2,"method":"session/new","params":{}}` + "\n"

	for _, part := range []string{initialize[:20], initialize[20:], after[:5], after[5:]} {
		n, err := to.Write([]byte(part))
		require.NoError(t, err)
		assert.Equal(t, len(part), n)
	}

	written := strings.SplitAfter(out.String(), "\n")
	require.Len(t, written, 3)
	assert.Contains(t, written[0], `"compaction":{}`)
	assert.Equal(t, after, written[1])
}

func TestUpdatesTheSDKDoesNotKnowAreLoggedAsTheAgentSentThem(t *testing.T) {
	t.Setenv("ZASPER_FAKE_AGENT_COMMANDS", "1")
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("notice"))
	waitFor(t, chat, turnEnded)
	require.NoError(t, chat.Prompt("/compact"))
	events := waitFor(t, chat, func(event Event) bool { return event.Type == "turn_end" && event.Seq > 5 })

	var kinds []string
	for _, event := range events {
		var update map[string]any
		if event.Type == "update" && json.Unmarshal(event.Update, &update) == nil {
			kinds = append(kinds, update["sessionUpdate"].(string))
			if update["sessionUpdate"] == "notice" {
				assert.Equal(t, "Auto mode is not available", update["title"])
				assert.Equal(t, "warning", update["severity"])
			}
			if update["sessionUpdate"] == "compaction_update" && update["status"] == "completed" {
				assert.Equal(t, "c1", update["compactionId"])
				assert.NotEmpty(t, update["summary"])
			}
		}
	}
	assert.Subset(t, kinds, []string{"notice", "compaction_update", "compaction_summary_chunk", "usage_update"})
	assert.NotContains(t, kinds, "session_info_update")
}
