/*
Package agenttest is a scripted ACP agent for tests: a test binary that is started with ZASPER_FAKE_AGENT
set calls Serve, and answers each prompt from a script, so tests start a real agent process over real
pipes with no agent installed.

	hello  streams "Hello there" and ends the turn
	write  writes notes.txt through the editor, then says so
	read   reads notes.txt through the editor, and says what it holds
	ask    asks permission, and says which option was chosen
	edit   asks permission to edit a file, and says which option was chosen
	wait   says "waiting", then works until the turn is cancelled
	run …  runs the rest of the line in a terminal of the editor's, and says how it ended and what it printed

At the start of a session it writes the names of the MCP servers it was given to mcp-servers.txt.
*/
package agenttest

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	acp "github.com/coder/acp-go-sdk"
)

// Requested says whether this process was started to be the agent.
func Requested() bool { return os.Getenv("ZASPER_FAKE_AGENT") == "1" }

// Serve is the agent, on stdin and stdout, until its client goes.
func Serve() {
	a := &agent{}
	a.conn = acp.NewAgentSideConnection(a, os.Stdout, os.Stdin)
	<-a.conn.Done()
}

type agent struct {
	conn *acp.AgentSideConnection
	cwd  string
}

func (a *agent) Initialize(context.Context, acp.InitializeRequest) (acp.InitializeResponse, error) {
	return acp.InitializeResponse{ProtocolVersion: acp.ProtocolVersionNumber}, nil
}

func (a *agent) NewSession(_ context.Context, request acp.NewSessionRequest) (acp.NewSessionResponse, error) {
	a.cwd = request.Cwd
	names := make([]string, 0, len(request.McpServers))
	for _, server := range request.McpServers {
		if server.Http != nil {
			names = append(names, server.Http.Name)
		}
		if server.Stdio != nil {
			names = append(names, server.Stdio.Name)
		}
	}
	os.WriteFile(filepath.Join(request.Cwd, "mcp-servers.txt"), []byte(strings.Join(names, ",")), 0o644)
	return acp.NewSessionResponse{SessionId: "fake-session"}, nil
}

func (a *agent) say(ctx context.Context, session acp.SessionId, text string) {
	a.conn.SessionUpdate(ctx, acp.SessionNotification{SessionId: session, Update: acp.UpdateAgentMessageText(text)})
}

func (a *agent) Prompt(ctx context.Context, request acp.PromptRequest) (acp.PromptResponse, error) {
	text := ""
	if len(request.Prompt) > 0 && request.Prompt[0].Text != nil {
		text = request.Prompt[0].Text.Text
	}
	session := request.SessionId
	if command, ok := strings.CutPrefix(text, "run "); ok {
		a.run(ctx, session, command)
		return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
	}
	switch text {
	case "hello":
		a.say(ctx, session, "Hello")
		a.say(ctx, session, " there")
	case "write":
		_, err := a.conn.WriteTextFile(ctx, acp.WriteTextFileRequest{SessionId: session, Path: filepath.Join(a.cwd, "notes.txt"), Content: "written by the agent\n"})
		if err != nil {
			a.say(ctx, session, "could not write: "+err.Error())
		} else {
			a.say(ctx, session, "wrote notes.txt")
		}
	case "read":
		read, err := a.conn.ReadTextFile(ctx, acp.ReadTextFileRequest{SessionId: session, Path: filepath.Join(a.cwd, "notes.txt")})
		if err != nil {
			a.say(ctx, session, "could not read: "+err.Error())
		} else {
			a.say(ctx, session, "notes.txt says: "+read.Content)
		}
	case "edit":
		kind := acp.ToolKindEdit
		answer, err := a.conn.RequestPermission(ctx, acp.RequestPermissionRequest{
			SessionId: session,
			ToolCall:  acp.ToolCallUpdate{ToolCallId: "call-2", Kind: &kind},
			Options: []acp.PermissionOption{
				{OptionId: "always", Name: "Always", Kind: acp.PermissionOptionKindAllowAlways},
				{OptionId: "once", Name: "Yes", Kind: acp.PermissionOptionKindAllowOnce},
				{OptionId: "reject", Name: "No", Kind: acp.PermissionOptionKindRejectOnce},
			},
		})
		if err == nil && answer.Outcome.Selected != nil {
			a.say(ctx, session, "chose "+string(answer.Outcome.Selected.OptionId))
		}
	case "ask":
		answer, err := a.conn.RequestPermission(ctx, acp.RequestPermissionRequest{
			SessionId: session,
			ToolCall:  acp.ToolCallUpdate{ToolCallId: "call-1"},
			Options: []acp.PermissionOption{
				{OptionId: "allow", Name: "Allow", Kind: acp.PermissionOptionKindAllowOnce},
				{OptionId: "reject", Name: "Reject", Kind: acp.PermissionOptionKindRejectOnce},
			},
		})
		switch {
		case err != nil:
			a.say(ctx, session, "could not ask: "+err.Error())
		case answer.Outcome.Selected != nil:
			a.say(ctx, session, "chose "+string(answer.Outcome.Selected.OptionId))
		default:
			a.say(ctx, session, "the question was withdrawn")
		}
	case "wait":
		a.say(ctx, session, "waiting")
		<-ctx.Done()
		return acp.PromptResponse{StopReason: acp.StopReasonCancelled}, nil
	}
	return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
}

func (a *agent) Cancel(context.Context, acp.CancelNotification) error { return nil }

func (a *agent) Authenticate(context.Context, acp.AuthenticateRequest) (acp.AuthenticateResponse, error) {
	return acp.AuthenticateResponse{}, nil
}

func (a *agent) Logout(context.Context, acp.LogoutRequest) (acp.LogoutResponse, error) {
	return acp.LogoutResponse{}, nil
}

func (a *agent) CloseSession(context.Context, acp.CloseSessionRequest) (acp.CloseSessionResponse, error) {
	return acp.CloseSessionResponse{}, nil
}

func (a *agent) ListSessions(context.Context, acp.ListSessionsRequest) (acp.ListSessionsResponse, error) {
	return acp.ListSessionsResponse{}, nil
}

func (a *agent) ResumeSession(context.Context, acp.ResumeSessionRequest) (acp.ResumeSessionResponse, error) {
	return acp.ResumeSessionResponse{}, nil
}

func (a *agent) SetSessionConfigOption(context.Context, acp.SetSessionConfigOptionRequest) (acp.SetSessionConfigOptionResponse, error) {
	return acp.SetSessionConfigOptionResponse{}, nil
}

func (a *agent) SetSessionMode(context.Context, acp.SetSessionModeRequest) (acp.SetSessionModeResponse, error) {
	return acp.SetSessionModeResponse{}, nil
}

// run runs command in a terminal, shown in a tool call as an editor would, and releases it once it ends.
func (a *agent) run(ctx context.Context, session acp.SessionId, command string) {
	terminal, err := a.conn.CreateTerminal(ctx, acp.CreateTerminalRequest{SessionId: session, Command: command})
	if err != nil {
		a.say(ctx, session, "could not run: "+err.Error())
		return
	}
	id := terminal.TerminalId
	a.conn.SessionUpdate(ctx, acp.SessionNotification{SessionId: session, Update: acp.StartToolCall("run-1", command,
		acp.WithStartKind(acp.ToolKindExecute), acp.WithStartStatus(acp.ToolCallStatusInProgress),
		acp.WithStartContent([]acp.ToolCallContent{acp.ToolTerminalRef(id)}))})
	exit, err := a.conn.WaitForTerminalExit(ctx, acp.WaitForTerminalExitRequest{SessionId: session, TerminalId: id})
	if err != nil {
		a.say(ctx, session, "could not wait: "+err.Error())
		return
	}
	output, err := a.conn.TerminalOutput(ctx, acp.TerminalOutputRequest{SessionId: session, TerminalId: id})
	if err != nil {
		a.say(ctx, session, "could not read the output: "+err.Error())
		return
	}
	a.conn.ReleaseTerminal(ctx, acp.ReleaseTerminalRequest{SessionId: session, TerminalId: id})
	a.conn.SessionUpdate(ctx, acp.SessionNotification{SessionId: session, Update: acp.UpdateToolCall("run-1",
		acp.WithUpdateStatus(acp.ToolCallStatusCompleted))})
	ended := "signal " + deref(exit.Signal)
	if exit.ExitCode != nil {
		ended = fmt.Sprintf("exit %d", *exit.ExitCode)
	}
	a.say(ctx, session, ended+": "+output.Output)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
