package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	acp "github.com/coder/acp-go-sdk"
	"github.com/google/uuid"
)

// errNoTerminals answers terminal requests, which this client does not offer yet.
var errNoTerminals = errors.New("Zasper does not run terminal commands for agents yet")

// chatClient is what the agent calls on the editor, for one chat.
type chatClient struct{ chat *Chat }

var _ acp.Client = chatClient{}

func (c chatClient) SessionUpdate(_ context.Context, notification acp.SessionNotification) error {
	update, err := json.Marshal(notification.Update)
	if err != nil {
		return err
	}
	c.chat.record(Event{Type: "update", Update: update})
	return nil
}

// RequestPermission asks the reader, and waits for their answer or for the turn to be cancelled.
func (c chatClient) RequestPermission(ctx context.Context, request acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
	id := uuid.New().String()
	answer := make(chan string, 1)
	c.chat.mu.Lock()
	c.chat.pending[id] = answer
	c.chat.mu.Unlock()
	c.chat.record(Event{Type: "permission", Permission: &Permission{ID: id, Request: &request}})

	cancelled := acp.RequestPermissionResponse{Outcome: acp.RequestPermissionOutcome{Cancelled: &acp.RequestPermissionOutcomeCancelled{}}}
	select {
	case option, ok := <-answer:
		c.chat.record(Event{Type: "answered", Permission: &Permission{ID: id, OptionID: option}})
		if !ok || option == "" {
			return cancelled, nil
		}
		return acp.RequestPermissionResponse{Outcome: acp.RequestPermissionOutcome{
			Selected: &acp.RequestPermissionOutcomeSelected{OptionId: acp.PermissionOptionId(option)},
		}}, nil
	case <-ctx.Done():
		c.chat.mu.Lock()
		delete(c.chat.pending, id)
		c.chat.mu.Unlock()
		c.chat.record(Event{Type: "answered", Permission: &Permission{ID: id}})
		return cancelled, nil
	}
}

// inProject is path when it is inside the project; an agent asks for absolute paths.
func (c chatClient) inProject(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("the path must be absolute: %s", path)
	}
	rel, err := filepath.Rel(c.chat.root, filepath.Clean(path))
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%s is outside the project", path)
	}
	return rel, nil
}

func (c chatClient) ReadTextFile(_ context.Context, request acp.ReadTextFileRequest) (acp.ReadTextFileResponse, error) {
	rel, err := c.inProject(request.Path)
	if err != nil {
		return acp.ReadTextFileResponse{}, err
	}
	content, err := c.chat.files.Read(rel)
	if err != nil {
		return acp.ReadTextFileResponse{}, err
	}
	if request.Line != nil || request.Limit != nil {
		lines := strings.Split(content, "\n")
		start := 0
		if request.Line != nil && *request.Line > 1 {
			start = min(*request.Line-1, len(lines))
		}
		end := len(lines)
		if request.Limit != nil && *request.Limit > 0 {
			end = min(start+*request.Limit, end)
		}
		content = strings.Join(lines[start:end], "\n")
	}
	return acp.ReadTextFileResponse{Content: content}, nil
}

func (c chatClient) WriteTextFile(_ context.Context, request acp.WriteTextFileRequest) (acp.WriteTextFileResponse, error) {
	rel, err := c.inProject(request.Path)
	if err != nil {
		return acp.WriteTextFileResponse{}, err
	}
	return acp.WriteTextFileResponse{}, c.chat.files.Write(rel, request.Content, c.chat.Agent)
}

func (chatClient) CreateTerminal(context.Context, acp.CreateTerminalRequest) (acp.CreateTerminalResponse, error) {
	return acp.CreateTerminalResponse{}, errNoTerminals
}

func (chatClient) KillTerminal(context.Context, acp.KillTerminalRequest) (acp.KillTerminalResponse, error) {
	return acp.KillTerminalResponse{}, errNoTerminals
}

func (chatClient) TerminalOutput(context.Context, acp.TerminalOutputRequest) (acp.TerminalOutputResponse, error) {
	return acp.TerminalOutputResponse{}, errNoTerminals
}

func (chatClient) ReleaseTerminal(context.Context, acp.ReleaseTerminalRequest) (acp.ReleaseTerminalResponse, error) {
	return acp.ReleaseTerminalResponse{}, errNoTerminals
}

func (chatClient) WaitForTerminalExit(context.Context, acp.WaitForTerminalExitRequest) (acp.WaitForTerminalExitResponse, error) {
	return acp.WaitForTerminalExitResponse{}, errNoTerminals
}
