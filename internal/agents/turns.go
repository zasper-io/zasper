package agents

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/checkpoint"
	"github.com/zasper-io/zasper/internal/gitclient"
)

// How long taking a snapshot may hold a turn's start or end. The first one in a project reads every file.
const snapshotBudget = 2 * time.Minute

// TurnChanges is what one turn changed in the project, or, on an `undone` event, the turn taken back.
type TurnChanges struct {
	Turn  int                 `json:"turn"`
	Files []checkpoint.Change `json:"files,omitempty"`
}

// turn is one of the reader's messages and the agent's answer to it, with the files it changed.
type turn struct {
	changes []checkpoint.Change
	undone  bool
}

// snapshot records the project as it is now, pinned as pin, or "" when there is no store or it failed.
func (c *Chat) snapshot(pin string) string {
	c.mu.Lock()
	if c.checkpoints == nil || c.closing {
		c.mu.Unlock()
		return ""
	}
	c.snapshotting.Add(1)
	c.mu.Unlock()
	defer c.snapshotting.Done()
	ctx, cancel := context.WithTimeout(c.lifetime, snapshotBudget)
	defer cancel()
	if pin != "" {
		pin = c.ID + "/" + pin
	}
	tree, err := c.checkpoints.Snapshot(ctx, pin)
	if err != nil {
		log.Warn().Err(err).Str("chat", c.ID).Msg("could not take a snapshot of the project")
		return ""
	}
	return tree
}

// endTurn records what the turn that began at before changed, when both snapshots could be taken.
func (c *Chat) endTurn(number int, before string) {
	after := c.snapshot(fmt.Sprintf("%d/after", number))
	if before == "" || after == "" {
		return
	}
	changes, err := c.checkpoints.Changes(context.Background(), before, after)
	if err != nil {
		log.Warn().Err(err).Str("chat", c.ID).Msg("could not list what a turn changed")
		return
	}
	c.mu.Lock()
	c.turns[number] = &turn{changes: changes}
	c.mu.Unlock()
	if len(changes) > 0 {
		c.record(Event{Type: "changes", Changes: &TurnChanges{Turn: number, Files: changes}})
	}
}

func (c *Chat) turnChanges(number int) (*turn, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	found, ok := c.turns[number]
	switch {
	case !ok:
		return nil, fmt.Errorf("no changes are known for turn %d", number)
	case found == nil:
		return nil, fmt.Errorf("turn %d has not ended", number)
	}
	return found, nil
}

// Diff is one file a turn changed, as it was before the turn and as the turn left it.
func (c *Chat) Diff(ctx context.Context, number int, path string) (gitclient.DiffResponse, error) {
	found, err := c.turnChanges(number)
	if err != nil {
		return gitclient.DiffResponse{}, err
	}
	for _, change := range found.changes {
		if change.Path != path {
			continue
		}
		var sides [2][]byte
		for i, blob := range []string{change.Before, change.After} {
			if blob == "" {
				continue
			}
			if sides[i], err = c.checkpoints.Blob(ctx, blob); err != nil {
				return gitclient.DiffResponse{}, err
			}
		}
		return gitclient.Compare(path, sides[0], sides[1]), nil
	}
	return gitclient.DiffResponse{}, fmt.Errorf("turn %d did not change %s", number, path)
}

// ChangedSince is the refusal of an undo whose files have changed after the turn: Paths are those files.
type ChangedSince struct{ Paths []string }

func (e *ChangedSince) Error() string {
	return fmt.Sprintf("%d of the files have changed since", len(e.Paths))
}

var errUndone = errors.New("that turn has already been taken back")

/*
Undo puts the files a turn changed back as they were before it. A file that has changed after the turn
is refused with ChangedSince unless anyway is set, which puts it back regardless.
*/
func (c *Chat) Undo(ctx context.Context, number int, anyway bool) error {
	found, err := c.turnChanges(number)
	if err != nil {
		return err
	}
	c.mu.Lock()
	busy, undone := c.answering, found.undone
	c.mu.Unlock()
	switch {
	case undone:
		return errUndone
	case busy:
		return ErrBusy
	}
	if !anyway {
		moved, err := c.checkpoints.Since(ctx, found.changes)
		if err != nil {
			return err
		}
		if len(moved) > 0 {
			return &ChangedSince{Paths: moved}
		}
	}
	if err := c.checkpoints.Restore(ctx, found.changes); err != nil {
		return err
	}
	c.mu.Lock()
	found.undone = true
	c.mu.Unlock()
	c.record(Event{Type: "undone", Changes: &TurnChanges{Turn: number}})
	return nil
}

// releaseTurns lets go of the snapshots of the chat's turns, which are no longer to be shown or undone.
func (c *Chat) releaseTurns() {
	if c.checkpoints == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), snapshotBudget)
	defer cancel()
	if err := c.checkpoints.Release(ctx, c.ID); err != nil {
		log.Warn().Err(err).Str("chat", c.ID).Msg("could not let go of a chat's snapshots")
	}
}
