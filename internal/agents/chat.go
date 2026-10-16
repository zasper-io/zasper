package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/checkpoint"
	"github.com/zasper-io/zasper/internal/kernel/launcher"
)

// How long an agent may take to answer its handshake: `npx` may be fetching the adapter the first time.
const startBudget = 2 * time.Minute

// ErrBusy answers a prompt sent while the agent is still on the last one.
var ErrBusy = errors.New("the agent is still answering the last message")

// Files is how an agent reads and writes the project: through Zasper, so that a write is checked and
// attributed like any agent's, and a read can see what an editor has not saved.
type Files interface {
	Read(path string) (string, error)
	Write(path, content, client string) error
}

/*
Event is one entry in a chat's log, in the order things happened.

	user        the reader's message, in Text
	update      what the agent streamed, as ACP's session/update has it, in Update
	permission  the agent asks before doing something; answered by an `answered` with the same ID
	answered    the option chosen, or none when the question was withdrawn; Auto when the chat's mode chose
	mode        the chat's permission mode changed, to Text
	terminal    what a command the agent runs in Zasper printed, and how it ended, in Terminal
	changes     the files the turn that has just ended changed, in Changes
	undone      the files a turn changed were put back, the turn in Changes
	turn_end    the agent has finished answering, with ACP's stop reason
	error       something went wrong, in Text
	exited      the agent's process has ended
*/
type Event struct {
	Seq        int             `json:"seq"`
	Type       string          `json:"type"`
	Text       string          `json:"text,omitempty"`
	Update     json.RawMessage `json:"update,omitempty"`
	Permission *Permission     `json:"permission,omitempty"`
	StopReason string          `json:"stop_reason,omitempty"`
	Terminal   *TerminalOutput `json:"terminal,omitempty"`
	Changes    *TurnChanges    `json:"changes,omitempty"`
	// On a `user` event, what the message mentions.
	Mentions []Mention `json:"mentions,omitempty"`
}

// Permission is a question the agent asks before acting, and its answer once there is one.
type Permission struct {
	ID       string                        `json:"id"`
	Request  *acp.RequestPermissionRequest `json:"request,omitempty"`
	OptionID string                        `json:"option_id,omitempty"`
	// Answered by the chat's mode, not by the reader.
	Auto bool `json:"auto,omitempty"`
}

/*
The permission modes a chat runs in: what the agent may do without asking.

	ask     everything is asked
	edits   changing, moving and deleting files is allowed
	all     that, and running commands
*/
const (
	ModeAsk   = "ask"
	ModeEdits = "edits"
	ModeAll   = "all"
)

// allows says whether mode lets a tool of kind go on without asking.
func allows(mode string, kind acp.ToolKind) bool {
	switch kind {
	case acp.ToolKindEdit, acp.ToolKindDelete, acp.ToolKindMove:
		return mode == ModeEdits || mode == ModeAll
	case acp.ToolKindExecute:
		return mode == ModeAll
	}
	return false
}

// Chat is one conversation with one agent process.
type Chat struct {
	ID    string `json:"id"`
	Agent string `json:"agent"`
	// What the agent may do without asking: see ModeAsk.
	Mode string `json:"mode"`
	// The agent can list its past conversations in the project, and open one again.
	History bool `json:"history"`

	mu          sync.Mutex
	events      []Event
	subscribers map[chan Event]struct{}
	pending     map[string]chan string
	answering   bool
	exited      bool
	terminals   map[string]*agentTerminal
	// What each turn changed, by its number from 1; nil when no snapshot could be taken.
	turns       map[int]*turn
	checkpoints *checkpoint.Store
	// Snapshots being taken, which a chat that is closing cancels and waits for.
	snapshotting sync.WaitGroup
	closing      bool
	lifetime     context.Context

	conn    *acp.ClientSideConnection
	session acp.SessionId
	process *launcher.Process
	stop    context.CancelFunc
	files   Files
	root    string
	servers []acp.McpServer
	// The agent takes a resource's contents in a message, rather than only a link to it.
	embedded bool
}

// record appends an event and passes it to everyone watching, without waiting on any of them.
func (c *Chat) record(event Event) {
	c.mu.Lock()
	defer c.mu.Unlock()
	event.Seq = len(c.events) + 1
	c.events = append(c.events, event)
	for subscriber := range c.subscribers {
		select {
		case subscriber <- event:
		default:
			// Fell behind: dropped, and given the whole log again when it reconnects.
			delete(c.subscribers, subscriber)
			close(subscriber)
		}
	}
}

/*
Subscribe answers the log so far and a channel of what follows, from the same instant. The channel is
closed when the subscriber falls too far behind; unsubscribe is safe to call after that.
*/
func (c *Chat) Subscribe() ([]Event, <-chan Event, func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	events := append([]Event(nil), c.events...)
	updates := make(chan Event, 1024)
	c.subscribers[updates] = struct{}{}
	return events, updates, func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if _, ok := c.subscribers[updates]; ok {
			delete(c.subscribers, updates)
			close(updates)
		}
	}
}

// Prompt sends the reader's message and what it mentions, and answers at once: the agent's answer
// arrives in the log.
func (c *Chat) Prompt(text string, mentions ...Mention) error {
	blocks, err := c.promptBlocks(text, mentions)
	if err != nil {
		return err
	}
	c.mu.Lock()
	if c.exited {
		c.mu.Unlock()
		return errors.New("the agent has stopped; start a new chat")
	}
	if c.answering {
		c.mu.Unlock()
		return ErrBusy
	}
	c.answering = true
	number := len(c.turns) + 1
	c.turns[number] = nil
	c.mu.Unlock()

	c.record(Event{Type: "user", Text: text, Mentions: logged(mentions)})
	go func() {
		before := c.snapshot(fmt.Sprintf("%d/before", number))
		answer, err := c.conn.Prompt(context.Background(), acp.PromptRequest{
			SessionId: c.session,
			Prompt:    blocks,
		})
		changed := c.endTurn(number, before)
		c.mu.Lock()
		c.answering = false
		c.mu.Unlock()
		stopReason := "error"
		if err == nil {
			stopReason = string(answer.StopReason)
		}
		c.trackTurn(stopReason, changed, len(mentions))
		if err != nil {
			c.record(Event{Type: "error", Text: err.Error()})
			return
		}
		c.record(Event{Type: "turn_end", StopReason: string(answer.StopReason)})
	}()
	return nil
}

// Cancel asks the agent to stop the turn it is on, and withdraws any question it is waiting on.
func (c *Chat) Cancel() error {
	c.mu.Lock()
	for id, answer := range c.pending {
		close(answer)
		delete(c.pending, id)
	}
	c.mu.Unlock()
	return c.conn.Cancel(context.Background(), acp.CancelNotification{SessionId: c.session})
}

// Answer answers the agent's question id with one of the options it offered.
func (c *Chat) Answer(id, optionID string) error {
	c.mu.Lock()
	answer, ok := c.pending[id]
	if ok {
		delete(c.pending, id)
	}
	c.mu.Unlock()
	if !ok {
		return fmt.Errorf("the agent is not waiting on %s", id)
	}
	answer <- optionID
	close(answer)
	return nil
}

// SetMode changes what the agent may do without asking, for every tab watching.
func (c *Chat) SetMode(mode string) error {
	if mode != ModeAsk && mode != ModeEdits && mode != ModeAll {
		return fmt.Errorf("no such mode %q", mode)
	}
	c.mu.Lock()
	c.Mode = mode
	c.mu.Unlock()
	c.record(Event{Type: "mode", Text: mode})
	analytics.Track(analytics.EventAgentModeChanged, map[string]interface{}{"mode": mode})
	return nil
}

// trackTurn counts a turn that has ended: how, and how many files and mentions it had, never what.
func (c *Chat) trackTurn(stopReason string, filesChanged, mentions int) {
	analytics.Track(analytics.EventAgentTurnEnded, turnEvent(c.Agent, stopReason, filesChanged, mentions))
}

func turnEvent(agent, stopReason string, filesChanged, mentions int) map[string]interface{} {
	switch acp.StopReason(stopReason) {
	case acp.StopReasonEndTurn, acp.StopReasonCancelled, acp.StopReasonMaxTokens, acp.StopReasonMaxTurnRequests, acp.StopReasonRefusal:
	default:
		if stopReason != "error" {
			stopReason = "other"
		}
	}
	return map[string]interface{}{
		"agent":         analytics.AgentKind(agent),
		"stop_reason":   stopReason,
		"files_changed": analytics.Bucket(filesChanged),
		"mentions":      analytics.Bucket(mentions),
	}
}

func (c *Chat) mode() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.Mode
}

// close stops the agent's process and everything it started. A launcher like npx hands off to children
// that can outlive it outside its process group, so they are found first and stopped by name.
func (c *Chat) close() {
	c.mu.Lock()
	c.closing = true
	c.mu.Unlock()
	c.stop()
	c.snapshotting.Wait()
	c.releaseTurns()
	c.killTerminals()
	if c.process == nil {
		return
	}
	tree := c.process.Tree()
	c.process.Terminate()
	launcher.SignalTree(tree, false)
	select {
	case <-c.process.Done():
	case <-time.After(3 * time.Second):
		c.process.Kill()
	}
	launcher.SignalTree(tree, true)
}

// start launches the agent in root and opens its session, with mcpServers as the tools it is given.
func start(asked context.Context, argv []string, agent, root string, files Files, mcpServers []acp.McpServer, checkpoints *checkpoint.Store) (*Chat, error) {
	process, err := launcher.Launch(launcher.Spec{Argv: argv, Env: os.Environ(), Dir: root, KeepStdio: true})
	if err != nil {
		return nil, fmt.Errorf("could not start %s: %w", argv[0], err)
	}
	lifetime, stop := context.WithCancel(context.Background())
	chat := &Chat{
		ID:          uuid.New().String(),
		Agent:       agent,
		Mode:        ModeAsk,
		subscribers: map[chan Event]struct{}{},
		pending:     map[string]chan string{},
		terminals:   map[string]*agentTerminal{},
		turns:       map[int]*turn{},
		checkpoints: checkpoints,
		lifetime:    lifetime,
		process:     process,
		stop:        stop,
		files:       files,
		root:        root,
	}
	chat.conn = acp.NewClientSideConnection(chatClient{chat}, process.Stdin, process.Stdout)
	go func() {
		select {
		case <-process.Done():
			chat.mu.Lock()
			chat.exited = true
			chat.mu.Unlock()
			chat.record(Event{Type: "exited", Text: fmt.Sprintf("the agent exited with code %d", process.ExitCode())})
		case <-lifetime.Done():
		}
	}()

	ctx, cancel := context.WithTimeout(lifetime, startBudget)
	defer cancel()
	// Whoever asked for the start may give up on it; the handshake then ends, and the agent with it.
	stopAsking := context.AfterFunc(asked, cancel)
	defer stopAsking()
	initialized, err := chat.conn.Initialize(ctx, acp.InitializeRequest{
		ProtocolVersion: acp.ProtocolVersionNumber,
		ClientCapabilities: acp.ClientCapabilities{
			Fs:       acp.FileSystemCapabilities{ReadTextFile: true, WriteTextFile: true},
			Terminal: true,
			// Claude Code runs its commands itself, and with this sends their output and exit code apart
			// from the rest of the call, as it does for an editor that draws a terminal.
			Meta: map[string]any{"terminal_output": true},
		},
	})
	if err != nil {
		chat.close()
		return nil, fmt.Errorf("%s did not answer as an ACP agent: %w", argv[0], err)
	}
	capabilities := initialized.AgentCapabilities
	chat.History = capabilities.LoadSession && capabilities.SessionCapabilities.List != nil
	chat.embedded = capabilities.PromptCapabilities.EmbeddedContext
	if mcpServers == nil {
		mcpServers = []acp.McpServer{}
	}
	chat.servers = mcpServers
	session, err := chat.conn.NewSession(ctx, acp.NewSessionRequest{Cwd: root, McpServers: mcpServers})
	if err != nil {
		chat.close()
		return nil, fmt.Errorf("%s could not start a session: %w", argv[0], err)
	}
	chat.session = session.SessionId
	// The first snapshot of a project reads every file in it, which is better done before the first turn.
	go chat.snapshot("")
	log.Debug().Str("chat", chat.ID).Strs("argv", argv).Msg("agent started")
	return chat, nil
}
