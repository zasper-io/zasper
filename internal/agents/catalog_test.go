package agents

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/agents/agenttest"
)

func TestOpenCodeIsFoundOnPathOrWhereItsInstallerPutsIt(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("an executable is made here as a shell script")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("PATH", t.TempDir())

	path, found := opencodePath()
	if runtime.GOOS != "darwin" {
		assert.False(t, found, "nothing is installed")
		assert.Equal(t, "opencode", path)
	}

	installed := filepath.Join(home, ".opencode", "bin", "opencode")
	require.NoError(t, os.MkdirAll(filepath.Dir(installed), 0o755))
	require.NoError(t, os.WriteFile(installed, []byte("#!/bin/sh\n"), 0o755))
	path, found = opencodePath()
	assert.True(t, found)
	assert.Equal(t, installed, path, "off PATH, as a desktop launch has it")

	onPath := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(onPath, "opencode"), []byte("#!/bin/sh\n"), 0o755))
	t.Setenv("PATH", onPath)
	path, found = opencodePath()
	assert.True(t, found)
	assert.Equal(t, filepath.Join(onPath, "opencode"), path, "PATH first")

	argv, id, ok := commandFor("opencode", "")
	assert.True(t, ok)
	assert.Equal(t, "opencode", id)
	assert.Equal(t, []string{filepath.Join(onPath, "opencode"), "acp"}, argv)
}

func TestAnAgentThatSaysItSteersSteers(t *testing.T) {
	assert.True(t, saysItSteers(map[string]any{"steering": map[string]any{"supported": true}}))
	assert.False(t, saysItSteers(map[string]any{"steering": map[string]any{"supported": false}}))
	assert.False(t, saysItSteers(map[string]any{"steering": true}))
	assert.False(t, saysItSteers(nil))
}

func TestAChatCarriesTheWaysItsAgentOffersToSignIn(t *testing.T) {
	manager := signInManager(t)
	require.NoError(t, agenttest.SignIn())

	chat, err := startFake(manager)
	require.NoError(t, err)

	var ids []string
	for _, way := range chat.SignInWays {
		ids = append(ids, way.ID)
	}
	assert.Equal(t, []string{"fake-login", "fake-browser", "fake-key"}, ids)
	assert.NotEmpty(t, chat.SignInWays[0].Command, "a terminal way says what to type")
}

// A panel opened again draws the chat from the list: Send beside Stop, and the sign-in under More.
func TestTheChatListSaysWhatAStartAnswers(t *testing.T) {
	t.Setenv("ZASPER_FAKE_AGENT_OPENCODE", "1")
	manager, chat, _ := fakeChat(t)

	recorder := httptest.NewRecorder()
	manager.ListHandler(recorder, httptest.NewRequest(http.MethodGet, "/api/agents/chats", nil))

	var listed []map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &listed))
	require.Len(t, listed, 1)
	started, err := json.Marshal(chat)
	require.NoError(t, err)
	var answered map[string]any
	require.NoError(t, json.Unmarshal(started, &answered))
	assert.Equal(t, answered, listed[0])
	assert.Equal(t, true, listed[0]["steers"])
	assert.NotEmpty(t, listed[0]["sign_in_ways"])
}
