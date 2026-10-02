package kernel

import (
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/go-zeromq/zmq4"
)

//go:embed inspect.py
var inspectSource []byte

// Loads inspect.py as its own module rather than running it in the user's namespace, so reading the
// variables adds none. Loaded on every request, which costs microseconds and means an upgraded server
// never talks to the helper an older one left in a kernel.
var inspectCode = fmt.Sprintf(
	"exec(__import__('base64').b64decode('%s').decode(), __import__('sys').modules.setdefault("+
		"'_zasper_inspect', __import__('types').ModuleType('_zasper_inspect')).__dict__)",
	base64.StdEncoding.EncodeToString(inspectSource))

// ErrNotInspectable is answered for a kernel whose language the helper is not written in.
var ErrNotInspectable = errors.New("variables can only be read from a Python kernel")

// Variable is one name in the kernel's namespace, described without sending its value.
type Variable struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Module  string `json:"module"`
	Kind    string `json:"kind"`
	Shape   []int  `json:"shape"`
	Size    *int   `json:"size"`
	Summary string `json:"summary"`
	// Whether Preview can show it as a table.
	Viewable bool `json:"viewable"`
}

type Column struct {
	Name  string `json:"name"`
	Dtype string `json:"dtype"`
}

// Preview is a page of rows from a table-like variable.
type Preview struct {
	Columns      []Column        `json:"columns"`
	TotalColumns int             `json:"total_columns"`
	Index        []string        `json:"index"`
	Rows         [][]interface{} `json:"rows"`
	TotalRows    int             `json:"total_rows"`
	Offset       int             `json:"offset"`
	Error        string          `json:"error,omitempty"`
}

// Variables lists the user's names in the kernel. It waits behind a running cell, as any request to a
// kernel does, for as long as ctx allows.
func (km *KernelManager) Variables(ctx context.Context) ([]Variable, error) {
	variables := []Variable{}
	err := km.inspect(ctx, "__import__('_zasper_inspect').variables()", &variables)
	return variables, err
}

// Preview reads rows [offset, offset+limit) of the variable called name. name must already be a
// Python identifier; it is passed as a JSON string, which Python reads as the same string.
func (km *KernelManager) Preview(ctx context.Context, name string, offset, limit int) (Preview, error) {
	quoted, err := json.Marshal(name)
	if err != nil {
		return Preview{}, err
	}
	var preview Preview
	expression := fmt.Sprintf("__import__('_zasper_inspect').preview(%s, %d, %d)", quoted, offset, limit)
	err = km.inspect(ctx, expression, &preview)
	return preview, err
}

/*
inspect evaluates expression in the kernel through `user_expressions`, on a shell socket of its own and
with `silent` set: nothing is published as output, the execution count does not move, and nothing goes
into the history. The expression answers base64 JSON, whose repr is that string in quotes.
*/
func (km *KernelManager) inspect(ctx context.Context, expression string, into interface{}) error {
	if !strings.EqualFold(km.Spec.Language, "python") {
		return ErrNotInspectable
	}

	shell := km.ConnectionInfo.ConnectShell(ctx, zmq4.SocketIdentity("inspect-"+newID()))
	defer shell.Close()

	request := km.Session.MessageFromString("execute_request")
	request.Content = map[string]interface{}{
		"code":             inspectCode,
		"silent":           true,
		"store_history":    false,
		"user_expressions": map[string]string{"answer": expression},
		"allow_stdin":      false,
		"stop_on_error":    false,
	}
	if err := km.Session.send(shell, request); err != nil {
		return err
	}

	replies := make(chan *Message, 1)
	failed := make(chan error, 1)
	go func() {
		for {
			zmsg, err := shell.Recv()
			if err != nil {
				failed <- err
				return
			}
			reply, ok := km.Session.decode(zmsg, "shell")
			if ok && reply.ParentHeader.MsgID == request.Header.MsgID && reply.Header.MsgType == "execute_reply" {
				replies <- reply
				return
			}
		}
	}()

	select {
	case reply := <-replies:
		return decodeAnswer(reply, into)
	case err := <-failed:
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func decodeAnswer(reply *Message, into interface{}) error {
	content, _ := reply.Content.(map[string]interface{})
	if content["status"] != "ok" {
		return fmt.Errorf("the kernel could not run the inspector: %v: %v", content["ename"], content["evalue"])
	}
	expressions, _ := content["user_expressions"].(map[string]interface{})
	answer, _ := expressions["answer"].(map[string]interface{})
	if answer["status"] != "ok" {
		return fmt.Errorf("the kernel could not read its variables: %v: %v", answer["ename"], answer["evalue"])
	}
	data, _ := answer["data"].(map[string]interface{})
	text, _ := data["text/plain"].(string)

	encoded := strings.Trim(text, `'"`)
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return fmt.Errorf("the inspector's answer was not base64: %w", err)
	}
	return json.Unmarshal(decoded, into)
}
