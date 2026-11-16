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
	(history: it lists this session and "earlier", and loading "earlier" replays a question and its answer)
	(a message with more than its text says what else came with it, a line a block)
	run …  runs the rest of the line in a terminal of the editor's, and says how it ended and what it printed
	build  leaves plan mode, as an agent does when its plan is accepted, and says so
	name   names the chat "Sensor drift model", says the context is 91% full and cost $1.92, and says so
	/echo  says back what follows it, "echoed: …"
	(commands: with ZASPER_FAKE_AGENT_COMMANDS set, a session lists /echo and /compact as it opens)
	(settings: with ZASPER_FAKE_AGENT_SETTINGS set, a model, an effort only the first model has, a mode and a
	switch of no category; a session opened or loaded says them, and a change answers the whole set)

At the start of a session it writes the names of the MCP servers it was given to mcp-servers.txt.
*/
package agenttest

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

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
	// The settings' values, by id, when the agent has settings.
	values map[string]string
}

func (a *agent) Initialize(context.Context, acp.InitializeRequest) (acp.InitializeResponse, error) {
	if os.Getenv("ZASPER_FAKE_AGENT_SLOW") != "" {
		// An agent npx is still downloading: it says nothing for a long while.
		time.Sleep(time.Minute)
	}
	return acp.InitializeResponse{ProtocolVersion: acp.ProtocolVersionNumber, AgentCapabilities: acp.AgentCapabilities{
		LoadSession:         true,
		SessionCapabilities: acp.SessionCapabilities{List: &acp.SessionListCapabilities{}},
		PromptCapabilities:  acp.PromptCapabilities{EmbeddedContext: os.Getenv("ZASPER_FAKE_AGENT_PLAIN") == ""},
	}}, nil
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
	if os.Getenv("ZASPER_FAKE_AGENT_SETTINGS") != "" {
		a.values = map[string]string{"model": "large", "effort": "high", "mode": "plan", "fast": "off"}
	}
	if os.Getenv("ZASPER_FAKE_AGENT_COMMANDS") != "" {
		a.conn.SessionUpdate(context.Background(), acp.SessionNotification{SessionId: "fake-session", Update: acp.SessionUpdate{
			AvailableCommandsUpdate: &acp.SessionAvailableCommandsUpdate{SessionUpdate: "available_commands_update", AvailableCommands: []acp.AvailableCommand{
				{Name: "echo", Description: "Say it back", Input: &acp.AvailableCommandInput{Unstructured: &acp.UnstructuredCommandInput{Hint: "what to say"}}},
				{Name: "compact", Description: "Summarise the conversation so far"},
			}},
		}})
	}
	return acp.NewSessionResponse{SessionId: "fake-session", ConfigOptions: a.settings()}, nil
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
	if len(request.Prompt) > 1 {
		a.say(ctx, session, describe(request.Prompt[1:]))
		return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
	}
	if said, ok := strings.CutPrefix(text, "/echo"); ok {
		a.say(ctx, session, "echoed:"+said)
		return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
	}
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
	case "build":
		if a.values != nil {
			a.values["mode"] = "default"
			a.conn.SessionUpdate(ctx, acp.SessionNotification{SessionId: session, Update: acp.SessionUpdate{
				ConfigOptionUpdate: &acp.SessionConfigOptionUpdate{SessionUpdate: "config_option_update", ConfigOptions: a.settings()},
			}})
		}
		a.say(ctx, session, "building")
	case "name":
		title := "Sensor drift model"
		a.conn.SessionUpdate(ctx, acp.SessionNotification{SessionId: session, Update: acp.SessionUpdate{
			SessionInfoUpdate: &acp.SessionSessionInfoUpdate{SessionUpdate: "session_info_update", Title: &title},
		}})
		a.conn.SessionUpdate(ctx, acp.SessionNotification{SessionId: session, Update: acp.SessionUpdate{
			UsageUpdate: &acp.SessionUsageUpdate{SessionUpdate: "usage_update", Used: 182000, Size: 200000, Cost: &acp.Cost{Amount: 1.92, Currency: "USD"}},
		}})
		a.say(ctx, session, "named")
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

// ListSessions lists this session and one earlier conversation, a page each; the earlier one alone in
// a folder other than the session's.
func (a *agent) ListSessions(_ context.Context, request acp.ListSessionsRequest) (acp.ListSessionsResponse, error) {
	title, updated, next := "An earlier chat", "2026-10-11T09:00:00Z", "page-2"
	if request.Cursor != nil {
		return acp.ListSessionsResponse{Sessions: []acp.SessionInfo{
			{SessionId: "earlier", Cwd: a.cwd, Title: &title, UpdatedAt: &updated},
			{SessionId: "elsewhere", Cwd: "/somewhere/else", Title: &title},
		}}, nil
	}
	now := "This chat"
	return acp.ListSessionsResponse{Sessions: []acp.SessionInfo{{SessionId: "fake-session", Cwd: a.cwd, Title: &now}}, NextCursor: &next}, nil
}

// LoadSession replays the earlier conversation, a question and its answer.
func (a *agent) LoadSession(ctx context.Context, request acp.LoadSessionRequest) (acp.LoadSessionResponse, error) {
	if request.SessionId != "earlier" {
		return acp.LoadSessionResponse{}, fmt.Errorf("no conversation %s", request.SessionId)
	}
	a.conn.SessionUpdate(ctx, acp.SessionNotification{SessionId: request.SessionId, Update: acp.UpdateUserMessageText("what is 2 + 2?")})
	a.say(ctx, request.SessionId, "4")
	return acp.LoadSessionResponse{ConfigOptions: a.settings()}, nil
}

func (a *agent) ResumeSession(context.Context, acp.ResumeSessionRequest) (acp.ResumeSessionResponse, error) {
	return acp.ResumeSessionResponse{}, nil
}

func (a *agent) SetSessionConfigOption(_ context.Context, request acp.SetSessionConfigOptionRequest) (acp.SetSessionConfigOptionResponse, error) {
	if request.ValueId == nil {
		return acp.SetSessionConfigOptionResponse{}, fmt.Errorf("only choices here")
	}
	id, value := string(request.ValueId.ConfigId), string(request.ValueId.Value)
	if _, ok := a.values[id]; !ok {
		return acp.SetSessionConfigOptionResponse{}, fmt.Errorf("unknown config option: %s", id)
	}
	a.values[id] = value
	return acp.SetSessionConfigOptionResponse{ConfigOptions: a.settings()}, nil
}

// settings is the agent's settings as they stand: the small model has no effort.
func (a *agent) settings() []acp.SessionConfigOption {
	if a.values == nil {
		return nil
	}
	choice := func(id, name string, category acp.SessionConfigOptionCategory, values ...string) acp.SessionConfigOption {
		options := acp.SessionConfigSelectOptionsUngrouped{}
		for _, value := range values {
			description := "The " + value + " one"
			options = append(options, acp.SessionConfigSelectOption{Value: acp.SessionConfigValueId(value), Name: strings.ToUpper(value[:1]) + value[1:], Description: &description})
		}
		option := acp.NewSessionConfigOptionSelect(acp.SessionConfigValueId(a.values[id]), acp.SessionConfigSelectOptions{Ungrouped: &options})
		option.Select.Id, option.Select.Name = acp.SessionConfigId(id), name
		if category != "" {
			option.Select.Category = &category
		}
		return option
	}
	settings := []acp.SessionConfigOption{
		choice("mode", "Mode", acp.SessionConfigOptionCategoryMode, "default", "plan"),
		choice("model", "Model", acp.SessionConfigOptionCategoryModel, "large", "small"),
	}
	if a.values["model"] == "large" {
		settings = append(settings, choice("effort", "Effort", acp.SessionConfigOptionCategoryThoughtLevel, "low", "high"))
	}
	return append(settings, choice("fast", "Fast mode", "", "off", "on"))
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

// describe is a line for each block that came with a message's text.
func describe(blocks []acp.ContentBlock) string {
	var lines []string
	for _, block := range blocks {
		switch {
		case block.ResourceLink != nil:
			lines = append(lines, "link "+block.ResourceLink.Name+" "+block.ResourceLink.Uri)
		case block.Resource != nil && block.Resource.Resource.TextResourceContents != nil:
			contents := block.Resource.Resource.TextResourceContents
			lines = append(lines, "resource "+contents.Uri+" "+contents.Text)
		case block.Text != nil:
			lines = append(lines, "text "+block.Text.Text)
		}
	}
	return strings.Join(lines, "\n")
}
