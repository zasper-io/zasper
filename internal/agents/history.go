package agents

import (
	"context"
	"errors"
	"fmt"
	"time"

	acp "github.com/coder/acp-go-sdk"

	"github.com/zasper-io/zasper/internal/analytics"
)

// How long an agent may take to replay a past conversation.
const loadBudget = time.Minute

var errNoHistory = errors.New("this agent cannot open its past conversations")

// PastChat is one of the agent's past conversations in the project.
type PastChat struct {
	ID      string `json:"id"`
	Title   string `json:"title,omitempty"`
	Updated string `json:"updated,omitempty"`
	// The conversation this chat is in now.
	Current bool `json:"current,omitempty"`
}

// Past is a page of the agent's past conversations in the project, newest first as the agent keeps them,
// and the cursor of the next page, or "" after the last.
func (c *Chat) Past(ctx context.Context, cursor string) ([]PastChat, string, error) {
	if !c.History {
		return nil, "", errNoHistory
	}
	request := acp.ListSessionsRequest{Cwd: &c.root}
	if cursor != "" {
		request.Cursor = &cursor
	}
	page, err := c.conn.ListSessions(ctx, request)
	if err != nil {
		return nil, "", err
	}
	c.mu.Lock()
	current := c.session
	c.mu.Unlock()
	past := make([]PastChat, 0, len(page.Sessions))
	for _, session := range page.Sessions {
		if session.Cwd != c.root {
			continue
		}
		chat := PastChat{ID: string(session.SessionId), Current: session.SessionId == current}
		if session.Title != nil {
			chat.Title = *session.Title
		}
		if session.UpdatedAt != nil {
			chat.Updated = *session.UpdatedAt
		}
		past = append(past, chat)
	}
	next := ""
	if page.NextCursor != nil {
		next = *page.NextCursor
	}
	return past, next, nil
}

/*
Load opens one of the agent's past conversations in this chat, in place of the one it is in. The log
starts again with what the agent replays of it, and every tab is sent the new log: it is closed on them,
and reconnecting gives them the whole of it. A failed load leaves the agent where it was.
*/
func (c *Chat) Load(id string) error {
	c.mu.Lock()
	switch {
	case !c.History:
		c.mu.Unlock()
		return errNoHistory
	case c.exited:
		c.mu.Unlock()
		return errors.New("the agent has stopped; start a new chat")
	case c.answering:
		c.mu.Unlock()
		return ErrBusy
	}
	c.answering = true
	c.events = nil
	c.turns = map[int]*turn{}
	for subscriber := range c.subscribers {
		delete(c.subscribers, subscriber)
		close(subscriber)
	}
	mode := c.Mode
	c.mu.Unlock()
	// Before any turn of the conversation opened, which numbers its turns from 1 again.
	c.releaseTurns()

	if mode != ModeAsk {
		c.record(Event{Type: "mode", Text: mode})
	}
	ctx, cancel := context.WithTimeout(context.Background(), loadBudget)
	defer cancel()
	_, err := c.conn.LoadSession(ctx, acp.LoadSessionRequest{SessionId: acp.SessionId(id), Cwd: c.root, McpServers: c.servers})
	c.mu.Lock()
	c.answering = false
	if err == nil {
		c.session = acp.SessionId(id)
	}
	c.mu.Unlock()
	if err != nil {
		c.record(Event{Type: "error", Text: fmt.Sprintf("could not open that conversation: %v", err)})
		return err
	}
	analytics.Track(analytics.EventAgentConversationReopened, map[string]interface{}{"agent": analytics.AgentKind(c.Agent)})
	return nil
}
