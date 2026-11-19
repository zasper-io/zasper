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
	/compact  compacts the conversation, 182k to 18k tokens, as Claude Code's compaction_update has it
	notice  sends a warning notice, as Claude Code does
	plan   writes a plan for the reader outside the project, as Antigravity's Plan mode does, and links it
	story  tells a story slowly, done in ten seconds; with ZASPER_FAKE_AGENT_STEERS set it says it is
	       Antigravity, and a message sent meanwhile is taken into the turn as Antigravity takes one: the
	       story's prompt is answered at once, and the turn goes on to say "steered: …"
	question  asks two questions as one form, as Antigravity's ask_question does, and says the reply as
	          it came; to a client that cannot show a form, it writes the questions as text instead
	(sign-in: with ZASPER_FAKE_AGENT_SIGN_IN set, it offers three ways to sign in: its own program with
	`login` in a terminal; Fake Browser, which it carries out itself after a moment; and Fake Key, which
	takes a key in _meta.apiKey and holds it only while it runs, as Antigravity does, refusing without. Signing in leaves SignedInMarker in HOME; until then a session or a
	prompt is refused as Authentication required, and logout takes the marker away. It says who is
	signed in as auth/status_update, as Claude Code does, or with ZASPER_FAKE_AGENT_TIER set as
	Antigravity does, naming its plan in the session's _meta)
	explore  starts a subagent that greps and talks, tagged with its call as Claude Code tags them, and
	         leaves a command running in the background
	(commands: with ZASPER_FAKE_AGENT_COMMANDS set, a session lists /echo and /compact as it opens)
	(settings: with ZASPER_FAKE_AGENT_SETTINGS set, a model, an effort only the first model has, a mode and a
	switch of no category; a session opened or loaded says them, and a change answers the whole set)

At the start of a session it writes the names of the MCP servers it was given to mcp-servers.txt.
*/
package agenttest

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

// SignedInMarker is the file in HOME that says the fake agent is signed in.
const SignedInMarker = ".zasper-fake-agent-signed-in"

func markerPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, SignedInMarker)
}

// SignIn is the fake agent's terminal sign-in: it leaves the marker, as a real agent stores its login.
func SignIn() error {
	return os.WriteFile(markerPath(), []byte("signed in\n"), 0o600)
}

func signsIn() bool { return os.Getenv("ZASPER_FAKE_AGENT_SIGN_IN") != "" }

func saysPlan() bool { return os.Getenv("ZASPER_FAKE_AGENT_TIER") != "" }

func signedIn() bool {
	_, err := os.Stat(markerPath())
	return !signsIn() || err == nil
}

// notify sends a notification the SDK has no type for, as the agent writes it.
func (a *agent) notify(method string, params any) {
	line, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
	a.out.Write(append(line, '\n'))
}

// sayWhoIsSignedIn sends auth/status_update as Claude Code does, the address with it.
func (a *agent) sayWhoIsSignedIn() {
	if signedIn() {
		a.notify("auth/status_update", map[string]any{"state": "authenticated", "accounts": []any{
			map[string]any{"label": "Fake Pro", "active": true, "email": "someone@example.com"},
		}})
		return
	}
	a.notify("auth/status_update", map[string]any{"state": "unauthenticated", "accounts": []any{}})
}

// Requested says whether this process was started to be the agent.
func Requested() bool { return os.Getenv("ZASPER_FAKE_AGENT") == "1" }

// Serve is the agent, on stdin and stdout, until its client goes.
func Serve() {
	a := &agent{out: &lines{to: os.Stdout}, replies: make(chan json.RawMessage, 1)}
	a.conn = acp.NewAgentSideConnection(a, a.out, a.catchReplies(os.Stdin))
	<-a.conn.Done()
}

// lines writes whole lines, so that an update the SDK has no type for can be sent beside its own.
type lines struct {
	mu      sync.Mutex
	to      io.Writer
	pending []byte
}

func (l *lines) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pending = append(l.pending, p...)
	if end := bytes.LastIndexByte(l.pending, '\n'); end >= 0 {
		if _, err := l.to.Write(l.pending[:end+1]); err != nil {
			return 0, err
		}
		l.pending = append([]byte(nil), l.pending[end+1:]...)
	}
	return len(p), nil
}

// raw sends a session/update the SDK has no type for, as the agent writes it.
func (a *agent) raw(session acp.SessionId, update map[string]any) {
	line, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  acp.ClientMethodSessionUpdate,
		"params":  map[string]any{"sessionId": session, "update": update},
	})
	a.out.Write(append(line, '\n'))
}

type agent struct {
	conn *acp.AgentSideConnection
	out  *lines
	cwd  string
	// The settings' values, by id, when the agent has settings.
	values map[string]string
	// Signed in with a key, for as long as this process runs.
	keyed bool
	// The client can show a question as a form.
	forms bool
	// The client's answers to the questions this agent asks itself, beside the SDK.
	replies chan json.RawMessage
	mu      sync.Mutex
	// Closed when a message steers the story being told; nil when none is.
	steered chan struct{}
	// Stops the prompts being answered, as session/cancel stops them all.
	stops map[*context.CancelFunc]struct{}
}

func steers() bool { return os.Getenv("ZASPER_FAKE_AGENT_STEERS") != "" }

// The id of the question the agent asks, its answer caught before the SDK, which did not ask it.
const questionID = "fake-question"

// catchReplies passes what the client writes on to the SDK, keeping back the answer to the question.
func (a *agent) catchReplies(from io.Reader) io.Reader {
	out, in := io.Pipe()
	go func() {
		lines := bufio.NewReader(from)
		for {
			line, err := lines.ReadBytes('\n')
			var message struct {
				ID     string          `json:"id"`
				Result json.RawMessage `json:"result"`
			}
			if json.Unmarshal(line, &message) == nil && message.ID == questionID {
				a.replies <- message.Result
			} else if len(line) > 0 {
				in.Write(line)
			}
			if err != nil {
				in.CloseWithError(err)
				return
			}
		}
	}()
	return out
}

func (a *agent) Initialize(_ context.Context, request acp.InitializeRequest) (response acp.InitializeResponse, err error) {
	if forms := request.ClientCapabilities.Elicitation; forms != nil && forms.Form != nil {
		a.forms = true
	}
	defer func() {
		if steers() {
			// As Antigravity names itself, which is how Zasper knows it takes a message mid-turn.
			response.AgentInfo = &acp.Implementation{Name: "Antigravity ACP Server", Version: "fake"}
		}
	}()
	if os.Getenv("ZASPER_FAKE_AGENT_SLOW") != "" {
		// An agent npx is still downloading: it says nothing for a long while.
		time.Sleep(time.Minute)
	}
	response = acp.InitializeResponse{ProtocolVersion: acp.ProtocolVersionNumber, AgentCapabilities: acp.AgentCapabilities{
		LoadSession:         true,
		SessionCapabilities: acp.SessionCapabilities{List: &acp.SessionListCapabilities{}},
		PromptCapabilities:  acp.PromptCapabilities{EmbeddedContext: os.Getenv("ZASPER_FAKE_AGENT_PLAIN") == ""},
	}}
	if signsIn() {
		description := "Use a fake account "
		response.AuthMethods = []acp.AuthMethod{{Terminal: &acp.AuthMethodTerminalInline{
			Id: "fake-login", Name: "Fake Account", Description: &description, Type: "terminal", Args: []string{"login"},
		}}, {Agent: &acp.AuthMethodAgent{Id: "fake-browser", Name: "Fake Browser"}}, {Agent: &acp.AuthMethodAgent{Id: "fake-key", Name: "Fake Key"}}}
		response.AgentCapabilities.Auth.Logout = &acp.LogoutCapabilities{}
		if !saysPlan() {
			a.sayWhoIsSignedIn()
		}
	}
	return response, nil
}

func (a *agent) NewSession(_ context.Context, request acp.NewSessionRequest) (acp.NewSessionResponse, error) {
	if !signedIn() && !a.keyed {
		return acp.NewSessionResponse{}, acp.NewAuthRequired(nil)
	}
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
	response := acp.NewSessionResponse{SessionId: "fake-session", ConfigOptions: a.settings()}
	if saysPlan() {
		response.Meta = map[string]any{"antigravity": map[string]any{"tier": map[string]any{"name": "Fake Tier", "id": "fake-tier"}}}
	}
	return response, nil
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
	if !signedIn() && !a.keyed {
		return acp.PromptResponse{}, acp.NewAuthRequired(nil)
	}
	ctx, stop := context.WithCancel(ctx)
	a.mu.Lock()
	if a.stops == nil {
		a.stops = map[*context.CancelFunc]struct{}{}
	}
	a.stops[&stop] = struct{}{}
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		delete(a.stops, &stop)
		a.mu.Unlock()
		stop()
	}()
	a.mu.Lock()
	steered := a.steered
	if steered != nil {
		a.steered = nil
		close(steered)
	}
	a.mu.Unlock()
	if steered != nil {
		a.say(ctx, session, " steered: "+text)
		return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
	}
	if len(request.Prompt) > 1 {
		a.say(ctx, session, describe(request.Prompt[1:]))
		return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
	}
	if said, ok := strings.CutPrefix(text, "/echo"); ok {
		a.say(ctx, session, "echoed:"+said)
		return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
	}
	if text == "/compact" {
		a.compact(ctx, session)
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
	case "explore":
		under := map[string]any{"claudeCode": map[string]any{"parentToolUseId": "task-1"}}
		a.raw(session, map[string]any{"sessionUpdate": "tool_call", "toolCallId": "task-1", "title": "Explore where readings are calibrated", "kind": "think", "status": "in_progress"})
		a.raw(session, map[string]any{"sessionUpdate": "tool_call", "toolCallId": "grep-1", "title": "grep calibrat", "kind": "search", "status": "completed", "_meta": under})
		a.raw(session, map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "the subagent thinking aloud"}, "_meta": under})
		a.raw(session, map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "task-1", "status": "completed"})
		a.raw(session, map[string]any{"sessionUpdate": "tool_call", "toolCallId": "bg-1", "title": "python load_raw.py --all", "kind": "execute", "status": "completed",
			"rawInput": map[string]any{"command": "python load_raw.py --all", "run_in_background": true}})
		a.say(ctx, session, "explored")
	case "notice":
		a.raw(session, map[string]any{"sessionUpdate": "notice", "severity": "warning", "title": "Auto mode is not available", "description": "The chat is in Manual."})
		a.say(ctx, session, "noticed")
	case "plan":
		// A plan written for the reader outside the project, as Antigravity's Plan mode writes one.
		plan := filepath.Join(os.TempDir(), "zasper-fake-agent-brain", "plan.md")
		a.raw(session, map[string]any{"sessionUpdate": "tool_call", "toolCallId": "plan-1", "title": "File ../../../.." + plan, "kind": "edit", "status": "completed",
			"locations": []any{map[string]any{"path": plan}},
			"rawInput":  map[string]any{"Path": plan, "Content": "# The plan\n\n1. Smooth the readings.", "ArtifactMetadata": map[string]any{"UserFacing": true}}})
		a.say(ctx, session, "Here is [plan.md](file://"+plan+").")
	case "question":
		return a.question(ctx, session)
	case "story":
		var steered chan struct{}
		if steers() {
			steered = make(chan struct{})
			a.mu.Lock()
			a.steered = steered
			a.mu.Unlock()
		}
		a.say(ctx, session, "Once upon a time")
		select {
		case <-steered:
			// Antigravity answers the turn's first prompt the moment another comes, and goes on with it.
		case <-ctx.Done():
			// The SDK cancels a session's prompt as another comes for it, before that one's handler runs:
			// a steer is told from a Stop by whether the steer follows.
			if steered != nil {
				select {
				case <-steered:
					return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
				case <-time.After(time.Second):
				}
			}
			return acp.PromptResponse{StopReason: acp.StopReasonCancelled}, nil
		case <-time.After(10 * time.Second):
			a.mu.Lock()
			a.steered = nil
			a.mu.Unlock()
			a.say(ctx, session, ", the end.")
		}
	case "wait":
		a.say(ctx, session, "waiting")
		<-ctx.Done()
		return acp.PromptResponse{StopReason: acp.StopReasonCancelled}, nil
	}
	return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
}

func (a *agent) Cancel(context.Context, acp.CancelNotification) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	for stop := range a.stops {
		(*stop)()
	}
	return nil
}

func (a *agent) Authenticate(_ context.Context, request acp.AuthenticateRequest) (acp.AuthenticateResponse, error) {
	switch request.MethodId {
	case "fake-browser":
		// The reader finishing in the browser.
		time.Sleep(500 * time.Millisecond)
		return acp.AuthenticateResponse{}, SignIn()
	case "fake-key":
		if key, _ := request.Meta["apiKey"].(string); key != "" {
			a.keyed = true
			return acp.AuthenticateResponse{}, nil
		}
		return acp.AuthenticateResponse{}, &acp.RequestError{Code: -32602, Message: "FAKE_KEY is not set."}
	}
	return acp.AuthenticateResponse{}, acp.NewInvalidParams(map[string]any{"methodId": request.MethodId})
}

func (a *agent) Logout(context.Context, acp.LogoutRequest) (acp.LogoutResponse, error) {
	os.Remove(markerPath())
	a.sayWhoIsSignedIn()
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

// compact compacts the conversation as Claude Code does: the context nearly full, the summary streamed,
// and the context small again.
func (a *agent) compact(ctx context.Context, session acp.SessionId) {
	usage := func(used int) {
		a.conn.SessionUpdate(ctx, acp.SessionNotification{SessionId: session, Update: acp.SessionUpdate{
			UsageUpdate: &acp.SessionUsageUpdate{SessionUpdate: "usage_update", Used: used, Size: 200000},
		}})
	}
	usage(182000)
	a.raw(session, map[string]any{"sessionUpdate": "compaction_update", "compactionId": "c1", "status": "in_progress"})
	for _, chunk := range []string{"Fitted a drift ", "per sensor."} {
		a.raw(session, map[string]any{"sessionUpdate": "compaction_summary_chunk", "compactionId": "c1", "content": map[string]any{"type": "text", "text": chunk}})
	}
	a.raw(session, map[string]any{"sessionUpdate": "compaction_update", "compactionId": "c1", "status": "completed",
		"summary": []any{map[string]any{"type": "text", "text": "Fitted a drift per sensor."}}})
	usage(18000)
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

// question asks as Antigravity's ask_question does: a single choice and a multiple one, each with Other,
// in one form tied to the call that asks. The properties are written out so their order is the agent's.
func (a *agent) question(ctx context.Context, session acp.SessionId) (acp.PromptResponse, error) {
	asked := map[string]any{"questions": []any{
		map[string]any{"question": "Which greeting word?", "options": []string{"(Recommended) hello", "hi", "hey"}, "is_multi_select": false},
		map[string]any{"question": "Which extras?", "options": []string{"a docstring", "type hints"}, "is_multi_select": true},
	}}
	a.raw(session, map[string]any{"sessionUpdate": "tool_call", "toolCallId": "ask-1", "title": "Run ask_question", "kind": "other", "status": "in_progress", "rawInput": asked})
	a.raw(session, map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "ask-1", "status": "pending"})
	if !a.forms {
		a.say(ctx, session, "Which greeting word?\n- [1] (Recommended) hello\n- [2] hi\n- [3] hey")
		return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
	}
	properties := `{
		"q1": {"type": "string", "title": "Which greeting word?", "oneOf": [{"const": "1", "title": "(Recommended) hello"}, {"const": "2", "title": "hi"}, {"const": "3", "title": "hey"}]},
		"q1_other": {"type": "string", "title": "Other", "description": "Optional free-form answer to: Which greeting word?"},
		"q2": {"type": "array", "title": "Which extras?", "items": {"anyOf": [{"const": "1", "title": "a docstring"}, {"const": "2", "title": "type hints"}]}},
		"q2_other": {"type": "string", "title": "Other", "description": "Optional free-form answer to: Which extras?"}
	}`
	line := `{"jsonrpc":"2.0","id":"` + questionID + `","method":"elicitation/create","params":{"sessionId":"` + string(session) +
		`","toolCallId":"ask-1","mode":"form","message":"The agent has a question.","requestedSchema":{"type":"object","properties":` +
		strings.Join(strings.Fields(properties), " ") + `}}}`
	a.out.Write([]byte(line + "\n"))
	select {
	case reply := <-a.replies:
		a.raw(session, map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "ask-1", "status": "completed"})
		a.say(ctx, session, "replied "+string(reply))
		return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
	case <-ctx.Done():
		return acp.PromptResponse{StopReason: acp.StopReasonCancelled}, nil
	}
}
