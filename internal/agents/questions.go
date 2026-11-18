package agents

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	acp "github.com/coder/acp-go-sdk"
	"github.com/google/uuid"
)

/*
A question the agent asks the reader as a form: ACP's `elicitation/create` in its form mode, which
Antigravity CLI sends from its `ask_question` tool. Read off the agent's pipe and answered on it, beside
the SDK: its form keeps neither the order of the fields, which is the order of the questions, nor the tool
call the form belongs to.
*/

// Question is a form the agent asks the reader to fill in, and the reply once there is one.
type Question struct {
	ID string `json:"id"`
	// The call that asks, when the agent says.
	ToolCallID string          `json:"tool_call_id,omitempty"`
	Message    string          `json:"message,omitempty"`
	Fields     []QuestionField `json:"fields,omitempty"`
	Required   []string        `json:"required,omitempty"`
	// On a `replied` event: accept, decline or cancel, and with accept what was filled in.
	Action  string         `json:"action,omitempty"`
	Content map[string]any `json:"content,omitempty"`
}

// QuestionField is one of a form's fields: its name, and its JSON Schema as the agent sent it.
type QuestionField struct {
	Name   string          `json:"name"`
	Schema json.RawMessage `json:"schema"`
}

type reply struct {
	action  string
	content map[string]any
}

// noteQuestion asks the reader the form in line, when the line is the agent asking one, and answers
// whether it was.
func (c *Chat) noteQuestion(line []byte) bool {
	var message struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Params struct {
			Mode            string `json:"mode"`
			Message         string `json:"message"`
			ToolCallID      string `json:"toolCallId"`
			RequestedSchema struct {
				Properties json.RawMessage `json:"properties"`
				Required   []string        `json:"required"`
			} `json:"requestedSchema"`
		} `json:"params"`
	}
	if json.Unmarshal(line, &message) != nil || message.Method != acp.ClientMethodElicitationCreate || len(message.ID) == 0 {
		return false
	}
	if message.Params.Mode != "form" {
		c.respond(message.ID, nil, &acp.RequestError{Code: -32602, Message: "Zasper shows a question as a form only"})
		return true
	}
	fields, err := orderedFields(message.Params.RequestedSchema.Properties)
	if err != nil {
		c.respond(message.ID, nil, &acp.RequestError{Code: -32602, Message: err.Error()})
		return true
	}
	question := Question{
		ID:         uuid.New().String(),
		ToolCallID: message.Params.ToolCallID,
		Message:    message.Params.Message,
		Fields:     fields,
		Required:   message.Params.RequestedSchema.Required,
	}
	answer := make(chan reply, 1)
	c.mu.Lock()
	c.questions[question.ID] = answer
	c.mu.Unlock()
	c.record(Event{Type: "question", Question: &question})
	go c.awaitReply(message.ID, question.ID, answer)
	return true
}

// awaitReply waits for the reader's reply to question id, or for the turn to be cancelled, and gives it
// to the agent as the answer to its request.
func (c *Chat) awaitReply(request json.RawMessage, id string, answer chan reply) {
	var got reply
	select {
	case given, ok := <-answer:
		got = given
		if !ok {
			got = reply{action: "cancel"}
		}
	case <-c.lifetime.Done():
		return
	}
	c.record(Event{Type: "replied", Question: &Question{ID: id, Action: got.action, Content: got.content}})
	result := map[string]any{"action": got.action}
	if got.action == "accept" {
		content := got.content
		if content == nil {
			content = map[string]any{}
		}
		result["content"] = content
	}
	c.respond(request, result, nil)
}

// Reply answers the agent's question id: accept, with what was filled in, or decline.
func (c *Chat) Reply(id, action string, content map[string]any) error {
	if action != "accept" && action != "decline" {
		return fmt.Errorf("no such reply %q", action)
	}
	c.mu.Lock()
	answer, ok := c.questions[id]
	if ok {
		delete(c.questions, id)
	}
	c.mu.Unlock()
	if !ok {
		return fmt.Errorf("the agent is not waiting on %s", id)
	}
	if action == "decline" {
		content = nil
	}
	answer <- reply{action: action, content: content}
	close(answer)
	return nil
}

// respond writes the answer to the agent's request id, as the SDK would have.
func (c *Chat) respond(id json.RawMessage, result any, failed *acp.RequestError) {
	message := map[string]any{"jsonrpc": "2.0", "id": id}
	if failed != nil {
		message["error"] = failed
	} else {
		message["result"] = result
	}
	line, err := json.Marshal(message)
	if err != nil {
		return
	}
	c.toAgent.Write(append(line, '\n'))
}

// orderedFields is a schema's properties in the order the agent wrote them.
func orderedFields(properties json.RawMessage) ([]QuestionField, error) {
	if len(bytes.TrimSpace(properties)) == 0 || string(bytes.TrimSpace(properties)) == "null" {
		return nil, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(properties))
	if open, err := decoder.Token(); err != nil || open != json.Delim('{') {
		return nil, errors.New("the form's properties are not an object")
	}
	var fields []QuestionField
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		var schema json.RawMessage
		if err := decoder.Decode(&schema); err != nil {
			return nil, err
		}
		fields = append(fields, QuestionField{Name: key.(string), Schema: schema})
	}
	return fields, nil
}
