package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/agents"
)

func TestAChatWithAnAgentRunsThroughTheAPIAndItsSocket(t *testing.T) {
	t.Setenv("ZASPER_FAKE_AGENT", "1")
	t.Setenv("HOME", t.TempDir())
	srv, project, _ := serverFor(t, true)

	status, body := call(t, srv, http.MethodPost, "/api/agents/chats", map[string]any{"command": os.Args[0] + " -test.run=^$"})
	require.Equal(t, http.StatusCreated, status, "body was %s", body)
	chat := decode[agents.Chat](t, body)

	socket, _, err := websocket.DefaultDialer.Dial(wsURL(t, srv, "/ws/agents/chats/"+chat.ID), nil)
	require.NoError(t, err)
	defer socket.Close()
	require.NoError(t, socket.WriteJSON(map[string]string{"type": "prompt", "text": "write"}))

	var said strings.Builder
	require.NoError(t, socket.SetReadDeadline(time.Now().Add(15*time.Second)))
	for {
		var event agents.Event
		require.NoError(t, socket.ReadJSON(&event))
		if event.Type == "update" {
			var update acp.SessionUpdate
			require.NoError(t, json.Unmarshal(event.Update, &update))
			if update.AgentMessageChunk != nil && update.AgentMessageChunk.Content.Text != nil {
				said.WriteString(update.AgentMessageChunk.Content.Text.Text)
			}
		}
		if event.Type == "turn_end" {
			break
		}
	}
	assert.Equal(t, "wrote notes.txt", said.String())
	written, err := os.ReadFile(filepath.Join(project, "notes.txt"))
	require.NoError(t, err)
	assert.Equal(t, "written by the agent\n", string(written))

	servers, err := os.ReadFile(filepath.Join(project, "mcp-servers.txt"))
	require.NoError(t, err)
	assert.Equal(t, "zasper", string(servers), "the agent was not given Zasper's tools")

	status, _ = call(t, srv, http.MethodDelete, "/api/agents/chats/"+chat.ID, nil)
	assert.Equal(t, http.StatusNoContent, status)
}

func TestTheAgentsKnownAreListedWithWhetherEachIsInstalled(t *testing.T) {
	srv, _ := testServer(t)

	status, body := call(t, srv, http.MethodGet, "/api/agents", nil)

	require.Equal(t, http.StatusOK, status)
	listed := decode[[]agents.Info](t, body)
	require.NotEmpty(t, listed)
	assert.Equal(t, "claude-code", listed[0].ID)
	assert.NotEmpty(t, listed[0].Hint)
}
