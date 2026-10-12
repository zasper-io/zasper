package agents

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"
	"unicode/utf8"

	acp "github.com/coder/acp-go-sdk"
	"github.com/google/uuid"

	"github.com/zasper-io/zasper/internal/kernel/launcher"
)

const (
	// What an agent is kept of a command's output when it names no limit, from the end.
	keptOutput = 1 << 20
	// How much of the output the panel is sent as it comes; past that, the end only, once it exits.
	streamedOutput = 256 << 10
	tailOutput     = 64 << 10
	// How often the panel is sent what a command has printed since.
	streamEvery = 100 * time.Millisecond
	// How long the output is given to end after the command has: something it left running in the
	// background can hold it open for ever.
	drainWait = 500 * time.Millisecond
)

/*
TerminalOutput is what the panel is told of a command the agent runs in Zasper: Output follows what was
sent before. The last one has Exited, and Cut when the panel was not sent all of it, its Output then
being the end of it alone.
*/
type TerminalOutput struct {
	ID       string  `json:"id"`
	Output   string  `json:"output,omitempty"`
	Exited   bool    `json:"exited,omitempty"`
	ExitCode *int    `json:"exit_code,omitempty"`
	Signal   *string `json:"signal,omitempty"`
	Cut      bool    `json:"cut,omitempty"`
}

// agentTerminal is one command an agent asked Zasper to run.
type agentTerminal struct {
	id      string
	process *launcher.Process
	limit   int

	mu        sync.Mutex
	output    []byte
	truncated bool
	unsent    []byte
	streamed  int
	cut       bool
	status    *acp.TerminalExitStatus
	// Closed once the command has exited and its output ended.
	exited chan struct{}
}

func (c *Chat) runTerminal(request acp.CreateTerminalRequest, dir string) (*agentTerminal, error) {
	argv := append([]string{request.Command}, request.Args...)
	if len(request.Args) == 0 {
		argv = []string{"/bin/sh", "-c", request.Command}
	}
	env := os.Environ()
	for _, variable := range request.Env {
		env = append(env, variable.Name+"="+variable.Value)
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	process, err := launcher.Launch(launcher.Spec{Argv: argv, Env: env, Dir: dir, Output: writer})
	writer.Close()
	if err != nil {
		reader.Close()
		return nil, fmt.Errorf("could not run %s: %w", request.Command, err)
	}
	terminal := &agentTerminal{id: uuid.New().String(), process: process, limit: keptOutput, exited: make(chan struct{})}
	if request.OutputByteLimit != nil && *request.OutputByteLimit >= 0 {
		terminal.limit = *request.OutputByteLimit
	}

	drained := make(chan struct{})
	go func() {
		defer close(drained)
		buffer := make([]byte, 32<<10)
		for {
			n, err := reader.Read(buffer)
			terminal.add(buffer[:n])
			if err != nil {
				return
			}
		}
	}()
	go func() {
		<-process.Done()
		select {
		case <-drained:
		case <-time.After(drainWait):
		}
		reader.Close()
		terminal.mu.Lock()
		terminal.status = exitStatus(process)
		terminal.mu.Unlock()
		close(terminal.exited)
	}()
	go c.streamTerminal(terminal)
	return terminal, nil
}

func exitStatus(process *launcher.Process) *acp.TerminalExitStatus {
	if signal := process.Signal(); signal != "" {
		return &acp.TerminalExitStatus{Signal: &signal}
	}
	code := process.ExitCode()
	return &acp.TerminalExitStatus{ExitCode: &code}
}

func (t *agentTerminal) add(data []byte) {
	if len(data) == 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.output = append(t.output, data...)
	if len(t.output) > t.limit {
		t.output = fromRuneStart(t.output[len(t.output)-t.limit:])
		t.truncated = true
	}
	if t.cut {
		return
	}
	if t.streamed+len(t.unsent)+len(data) > streamedOutput {
		t.cut = true
		t.unsent = nil
		return
	}
	t.unsent = append(t.unsent, data...)
}

// fromRuneStart drops the bytes of a character whose start was cut off.
func fromRuneStart(data []byte) []byte {
	for i := 0; i < len(data) && i < utf8.UTFMax; i++ {
		if utf8.RuneStart(data[i]) {
			return data[i:]
		}
	}
	return data
}

// completeRunes is how much of data ends on a whole character, so a chunk never splits one.
func completeRunes(data []byte) int {
	for i := len(data) - 1; i >= 0 && i >= len(data)-utf8.UTFMax; i-- {
		if utf8.RuneStart(data[i]) {
			if utf8.FullRune(data[i:]) {
				return len(data)
			}
			return i
		}
	}
	return len(data)
}

// streamTerminal sends the panel what the command prints, a little at a time, and how it ended.
func (c *Chat) streamTerminal(t *agentTerminal) {
	tick := time.NewTicker(streamEvery)
	defer tick.Stop()
	for {
		select {
		case <-t.exited:
			t.mu.Lock()
			last := TerminalOutput{ID: t.id, Exited: true, ExitCode: t.status.ExitCode, Signal: t.status.Signal}
			if t.cut {
				last.Cut = true
				last.Output = string(fromRuneStart(t.output[max(0, len(t.output)-tailOutput):]))
			} else {
				last.Output = string(t.unsent)
			}
			t.mu.Unlock()
			c.record(Event{Type: "terminal", Terminal: &last})
			return
		case <-tick.C:
			t.mu.Lock()
			n := completeRunes(t.unsent)
			chunk := string(t.unsent[:n])
			t.unsent = t.unsent[n:]
			t.streamed += n
			t.mu.Unlock()
			if chunk != "" {
				c.record(Event{Type: "terminal", Terminal: &TerminalOutput{ID: t.id, Output: chunk}})
			}
		}
	}
}

func (t *agentTerminal) snapshot() acp.TerminalOutputResponse {
	t.mu.Lock()
	defer t.mu.Unlock()
	return acp.TerminalOutputResponse{Output: string(t.output), Truncated: t.truncated, ExitStatus: t.status}
}

func (t *agentTerminal) wait(ctx context.Context) (*acp.TerminalExitStatus, error) {
	select {
	case <-t.exited:
		t.mu.Lock()
		defer t.mu.Unlock()
		return t.status, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// kill stops the command and everything it started; its output stays to be read.
func (t *agentTerminal) kill() {
	tree := t.process.Tree()
	t.process.Kill()
	launcher.SignalTree(tree, true)
}

var errNoTerminal = errors.New("no such terminal")

func (c *Chat) terminal(id string) (*agentTerminal, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	terminal, ok := c.terminals[id]
	if !ok {
		return nil, errNoTerminal
	}
	return terminal, nil
}

func (c *Chat) addTerminal(t *agentTerminal) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.terminals[t.id] = t
}

func (c *Chat) releaseTerminal(id string) (*agentTerminal, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	terminal, ok := c.terminals[id]
	delete(c.terminals, id)
	return terminal, ok
}

// killTerminals stops every command the agent left running, as the chat ends.
func (c *Chat) killTerminals() {
	c.mu.Lock()
	terminals := c.terminals
	c.terminals = map[string]*agentTerminal{}
	c.mu.Unlock()
	for _, terminal := range terminals {
		terminal.kill()
	}
}
