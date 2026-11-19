package agents

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func saidSoFar(text string) func(Event) bool {
	return func(e Event) bool { return e.Type == "update" && strings.Contains(string(e.Update), text) }
}

func count(events []Event, kind string) int {
	n := 0
	for _, event := range events {
		if event.Type == kind {
			n++
		}
	}
	return n
}

func TestASteeringAgentTakesAMessageIntoTheTurnItIsOn(t *testing.T) {
	t.Setenv("ZASPER_FAKE_AGENT_STEERS", "1")
	_, chat, _ := fakeChat(t)
	require.True(t, chat.Steers)

	require.NoError(t, chat.Prompt("story"))
	waitFor(t, chat, saidSoFar("Once upon a time"))
	require.NoError(t, chat.Prompt("make it shorter"))

	events := waitFor(t, chat, turnEnded)
	assert.Equal(t, "Once upon a time steered: make it shorter", agentText(events))
	assert.Equal(t, 2, count(events, "user"))
	// The agent answered the story's prompt the moment the second came; the turn went on regardless.
	assert.Equal(t, 1, count(events, "turn_end"))
	assert.Equal(t, "end_turn", events[len(events)-1].StopReason)

	require.NoError(t, chat.Prompt("hello"))
	events = waitFor(t, chat, func(e Event) bool { return e.Type == "turn_end" && e.Seq > events[len(events)-1].Seq })
	assert.Equal(t, 2, count(events, "turn_end"), "one turn each, the steered message's included")
	chat.mu.Lock()
	assert.Len(t, chat.turns, 2)
	chat.mu.Unlock()
}

func TestAnAgentThatDoesNotSteerIsBusyUntilItsTurnEnds(t *testing.T) {
	_, chat, _ := fakeChat(t)
	require.False(t, chat.Steers)

	require.NoError(t, chat.Prompt("story"))
	waitFor(t, chat, saidSoFar("Once upon a time"))

	assert.ErrorIs(t, chat.Prompt("make it shorter"), ErrBusy)
	require.NoError(t, chat.Cancel())
	events := waitFor(t, chat, turnEnded)
	assert.Equal(t, 1, count(events, "user"))
}

func TestStoppingASteeredTurnEndsItOnce(t *testing.T) {
	t.Setenv("ZASPER_FAKE_AGENT_STEERS", "1")
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("wait"))
	waitFor(t, chat, saidSoFar("waiting"))
	require.NoError(t, chat.Prompt("story"))
	waitFor(t, chat, saidSoFar("Once upon a time"))
	require.NoError(t, chat.Cancel())

	events := waitFor(t, chat, turnEnded)
	assert.Equal(t, 1, count(events, "turn_end"))
	assert.Equal(t, "cancelled", events[len(events)-1].StopReason)
}
