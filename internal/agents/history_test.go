package agents

import (
	"context"
	"encoding/json"
	"testing"

	acp "github.com/coder/acp-go-sdk"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTheAgentsPastConversationsInTheProjectAreListedAPageAtATime(t *testing.T) {
	_, chat, _ := fakeChat(t)
	require.True(t, chat.History)

	first, next, err := chat.Past(context.Background(), "")
	require.NoError(t, err)
	assert.Equal(t, []PastChat{{ID: "fake-session", Title: "This chat", Current: true}}, first)

	second, last, err := chat.Past(context.Background(), next)
	require.NoError(t, err)
	assert.Equal(t, []PastChat{{ID: "earlier", Title: "An earlier chat", Updated: "2026-10-11T09:00:00Z"}}, second)
	assert.Empty(t, last)
}

func TestLoadingAPastConversationStartsTheLogAgainWithIt(t *testing.T) {
	_, chat, _ := fakeChat(t)
	require.NoError(t, chat.SetMode(ModeEdits))
	require.NoError(t, chat.Prompt("hello"))
	waitFor(t, chat, turnEnded)
	_, before, _ := chat.Subscribe()

	require.NoError(t, chat.Load("earlier"))

	_, open := <-before
	assert.False(t, open, "a tab was left on the old log")
	events := chatEvents(chat)
	require.NotEmpty(t, events)
	assert.Equal(t, Event{Seq: 1, Type: "mode", Text: ModeEdits}, events[0])
	var asked acp.SessionUpdate
	require.NoError(t, json.Unmarshal(events[1].Update, &asked))
	require.NotNil(t, asked.UserMessageChunk)
	assert.Equal(t, "what is 2 + 2?", asked.UserMessageChunk.Content.Text.Text)
	assert.Equal(t, "4", agentText(events))

	past, _, err := chat.Past(context.Background(), "page-2")
	require.NoError(t, err)
	assert.True(t, past[0].Current)
	require.NoError(t, chat.Prompt("hello"))
	waitFor(t, chat, turnEnded)
}

func TestAConversationThatCannotBeOpenedLeavesTheChatWhereItWas(t *testing.T) {
	_, chat, _ := fakeChat(t)

	assert.Error(t, chat.Load("missing"))

	assert.Equal(t, "error", chatEvents(chat)[0].Type)
	require.NoError(t, chat.Prompt("hello"))
	assert.Contains(t, agentText(waitFor(t, chat, turnEnded)), "Hello there")
}

func TestAConversationIsNotOpenedWhileTheAgentIsAnswering(t *testing.T) {
	_, chat, _ := fakeChat(t)
	require.NoError(t, chat.Prompt("wait"))

	assert.ErrorIs(t, chat.Load("earlier"), ErrBusy)

	require.NoError(t, chat.Cancel())
}
