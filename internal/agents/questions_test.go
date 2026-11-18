package agents

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func asked(e Event) bool { return e.Type == "question" }

func TestTheAgentsQuestionIsAFormTheReaderAnswers(t *testing.T) {
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("question"))
	events := waitFor(t, chat, asked)
	question := events[len(events)-1].Question
	assert.Equal(t, "ask-1", question.ToolCallID)
	assert.Equal(t, "The agent has a question.", question.Message)
	var names []string
	for _, field := range question.Fields {
		names = append(names, field.Name)
	}
	assert.Equal(t, []string{"q1", "q1_other", "q2", "q2_other"}, names)

	require.NoError(t, chat.Reply(question.ID, "accept", map[string]any{"q1": "2", "q2": []any{"1"}}))

	events = waitFor(t, chat, turnEnded)
	assert.Contains(t, agentText(events), `replied {"action":"accept","content":{"q1":"2","q2":["1"]}}`)
	var replied *Question
	for _, event := range events {
		if event.Type == "replied" {
			replied = event.Question
		}
	}
	require.NotNil(t, replied)
	assert.Equal(t, question.ID, replied.ID)
	assert.Equal(t, "accept", replied.Action)
}

func TestSkippingAQuestionDeclinesIt(t *testing.T) {
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("question"))
	events := waitFor(t, chat, asked)
	id := events[len(events)-1].Question.ID
	require.NoError(t, chat.Reply(id, "decline", map[string]any{"q1": "1"}))

	events = waitFor(t, chat, turnEnded)
	assert.Contains(t, agentText(events), `replied {"action":"decline"}`)
	assert.Error(t, chat.Reply(id, "accept", nil), "a question is answered once")
}

func TestStoppingTheTurnCancelsTheQuestion(t *testing.T) {
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("question"))
	waitFor(t, chat, asked)
	require.NoError(t, chat.Cancel())

	events := waitFor(t, chat, func(e Event) bool { return e.Type == "replied" })
	assert.Equal(t, "cancel", events[len(events)-1].Question.Action)
}

func TestAReplyIsAcceptOrDecline(t *testing.T) {
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("question"))
	events := waitFor(t, chat, asked)

	assert.Error(t, chat.Reply(events[len(events)-1].Question.ID, "cancel", nil))
}

func TestAFormsFieldsKeepTheAgentsOrder(t *testing.T) {
	fields, err := orderedFields(json.RawMessage(`{"zeta": {"type": "string"}, "alpha": {"type": "boolean"}, "mid": {"type": "number"}}`))

	require.NoError(t, err)
	require.Len(t, fields, 3)
	assert.Equal(t, "zeta", fields[0].Name)
	assert.Equal(t, "alpha", fields[1].Name)
	assert.JSONEq(t, `{"type": "number"}`, string(fields[2].Schema))

	none, err := orderedFields(nil)
	require.NoError(t, err)
	assert.Empty(t, none)

	_, err = orderedFields(json.RawMessage(`[1]`))
	assert.Error(t, err)
}

func TestALinkToOpenIsRefused(t *testing.T) {
	var out bytes.Buffer
	chat := &Chat{questions: map[string]chan reply{}, toAgent: &out}

	took := chat.noteQuestion([]byte(`{"jsonrpc":"2.0","id":7,"method":"elicitation/create","params":{"sessionId":"s","mode":"url","elicitationId":"e","url":"https://example.com","message":"Sign in"}}`))

	assert.True(t, took)
	var answer struct {
		ID    int `json:"id"`
		Error struct {
			Code int `json:"code"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(out.Bytes(), &answer))
	assert.Equal(t, 7, answer.ID)
	assert.Equal(t, -32602, answer.Error.Code)
	assert.Empty(t, chat.events, "nothing is asked of the reader")

	assert.False(t, chat.noteQuestion([]byte(`{"jsonrpc":"2.0","method":"session/update","params":{}}`)))
}
