package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	acp "github.com/coder/acp-go-sdk"
	"github.com/google/uuid"

	"github.com/zasper-io/zasper/internal/analytics"
)

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
	// Allowed by the chat's mode: once, so that changing the mode back is not undone by the agent
	// remembering an "always".
	if kind := request.ToolCall.Kind; kind != nil && allows(c.chat.mode(), *kind) {
		for _, option := range request.Options {
			if option.Kind == acp.PermissionOptionKindAllowOnce {
				c.chat.record(Event{Type: "permission", Permission: &Permission{ID: id, Request: &request}})
				c.chat.record(Event{Type: "answered", Permission: &Permission{ID: id, OptionID: string(option.OptionId), Auto: true}})
				analytics.Track(analytics.EventAgentPermissionAnswered, map[string]interface{}{"answered_by": "mode", "allowed": true})
				return acp.RequestPermissionResponse{Outcome: acp.RequestPermissionOutcome{
					Selected: &acp.RequestPermissionOutcomeSelected{OptionId: option.OptionId},
				}}, nil
			}
		}
	}
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
		allowed := false
		for _, offered := range request.Options {
			if string(offered.OptionId) == option {
				allowed = offered.Kind == acp.PermissionOptionKindAllowOnce || offered.Kind == acp.PermissionOptionKindAllowAlways
			}
		}
		analytics.Track(analytics.EventAgentPermissionAnswered, map[string]interface{}{"answered_by": "reader", "allowed": allowed})
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

// CreateTerminal runs a command for the agent in the project, and streams what it prints to the panel.
func (c chatClient) CreateTerminal(_ context.Context, request acp.CreateTerminalRequest) (acp.CreateTerminalResponse, error) {
	dir := c.chat.root
	if request.Cwd != nil && *request.Cwd != "" {
		rel, err := c.inProject(*request.Cwd)
		if err != nil {
			return acp.CreateTerminalResponse{}, err
		}
		dir = filepath.Join(c.chat.root, rel)
	}
	terminal, err := c.chat.runTerminal(request, dir)
	if err != nil {
		return acp.CreateTerminalResponse{}, err
	}
	c.chat.addTerminal(terminal)
	return acp.CreateTerminalResponse{TerminalId: terminal.id}, nil
}

func (c chatClient) TerminalOutput(_ context.Context, request acp.TerminalOutputRequest) (acp.TerminalOutputResponse, error) {
	terminal, err := c.chat.terminal(request.TerminalId)
	if err != nil {
		return acp.TerminalOutputResponse{}, err
	}
	return terminal.snapshot(), nil
}

func (c chatClient) WaitForTerminalExit(ctx context.Context, request acp.WaitForTerminalExitRequest) (acp.WaitForTerminalExitResponse, error) {
	terminal, err := c.chat.terminal(request.TerminalId)
	if err != nil {
		return acp.WaitForTerminalExitResponse{}, err
	}
	status, err := terminal.wait(ctx)
	if err != nil {
		return acp.WaitForTerminalExitResponse{}, err
	}
	return acp.WaitForTerminalExitResponse{ExitCode: status.ExitCode, Signal: status.Signal}, nil
}

func (c chatClient) KillTerminal(_ context.Context, request acp.KillTerminalRequest) (acp.KillTerminalResponse, error) {
	terminal, err := c.chat.terminal(request.TerminalId)
	if err != nil {
		return acp.KillTerminalResponse{}, err
	}
	terminal.kill()
	return acp.KillTerminalResponse{}, nil
}

// ReleaseTerminal stops the command if it is still running; what it printed stays in the panel.
func (c chatClient) ReleaseTerminal(_ context.Context, request acp.ReleaseTerminalRequest) (acp.ReleaseTerminalResponse, error) {
	terminal, ok := c.chat.releaseTerminal(request.TerminalId)
	if !ok {
		return acp.ReleaseTerminalResponse{}, errNoTerminal
	}
	terminal.kill()
	return acp.ReleaseTerminalResponse{}, nil
}
