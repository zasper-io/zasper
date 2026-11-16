package agents

import (
	"testing"

	acp "github.com/coder/acp-go-sdk"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// settingsChat starts the fake agent with settings of its own.
func settingsChat(t *testing.T) *Chat {
	t.Helper()
	t.Setenv("ZASPER_FAKE_AGENT_SETTINGS", "1")
	_, chat, _ := fakeChat(t)
	return chat
}

// lastSettings is the agent's settings as the log last had them, value by id.
func lastSettings(t *testing.T, chat *Chat) map[string]string {
	t.Helper()
	var last *Event
	for _, event := range chatEvents(chat) {
		if event.Type == "settings" {
			last = &event
		}
	}
	require.NotNil(t, last, "the log has no settings")
	values := map[string]string{}
	for _, option := range last.Settings {
		require.NotNil(t, option.Select)
		values[string(option.Select.Id)] = string(option.Select.CurrentValue)
	}
	return values
}

func TestTheSettingsTheAgentOpensItsSessionWithAreInTheLog(t *testing.T) {
	chat := settingsChat(t)

	assert.Equal(t, map[string]string{"mode": "plan", "model": "large", "effort": "high", "fast": "off"}, lastSettings(t, chat))
}

func TestAnAgentWithNoSettingsKeepsTheChatsModes(t *testing.T) {
	_, chat, _ := fakeChat(t)

	assert.Empty(t, chatEvents(chat))
	require.NoError(t, chat.SetMode(ModeEdits))
	assert.True(t, chat.answersFor(acp.ToolKindEdit))
}

func TestChangingASettingLogsTheWholeSetTheAgentAnswers(t *testing.T) {
	chat := settingsChat(t)

	require.NoError(t, chat.SetSetting("model", "small"))

	assert.Equal(t, map[string]string{"mode": "plan", "model": "small", "fast": "off"}, lastSettings(t, chat))
}

func TestASettingTheAgentRefusesIsAnError(t *testing.T) {
	chat := settingsChat(t)

	assert.Error(t, chat.SetSetting("missing", "x"))
	assert.Error(t, chat.SetSetting("model", 3))
	assert.Error(t, chat.SetSetting("model", true), "the agent takes only choices")
}

func TestTheAgentChangingItsOwnSettingsIsLogged(t *testing.T) {
	chat := settingsChat(t)

	require.NoError(t, chat.Prompt("build"))
	waitFor(t, chat, turnEnded)

	assert.Equal(t, "default", lastSettings(t, chat)["mode"])
	for _, event := range chatEvents(chat) {
		assert.NotContains(t, string(event.Update), "config_option_update", "logged twice")
	}
}

func TestAnAgentWithModesOfItsOwnAsksTheReaderEverything(t *testing.T) {
	chat := settingsChat(t)

	assert.Error(t, chat.SetMode(ModeAll))
	assert.False(t, chat.answersFor(acp.ToolKindEdit))
}

func TestALoadedConversationHasTheSettingsTheAgentLoadsItWith(t *testing.T) {
	chat := settingsChat(t)
	require.NoError(t, chat.SetSetting("model", "small"))

	require.NoError(t, chat.Load("earlier", ""))

	assert.Equal(t, "small", lastSettings(t, chat)["model"])
}

func TestAConversationThatCannotBeOpenedKeepsTheSettings(t *testing.T) {
	chat := settingsChat(t)

	assert.Error(t, chat.Load("missing", ""))

	assert.Equal(t, "large", lastSettings(t, chat)["model"])
}
