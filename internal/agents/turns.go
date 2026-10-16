package agents

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	// The files put back, by path.
	undone map[string]bool
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
	c.turns[number] = &turn{changes: changes, undone: map[string]bool{}}
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

// TurnDiff is a file a turn changed: as it was before the turn, against the file on disk now, so that
// putting back a part of it composes with putting back another.
type TurnDiff struct {
	gitclient.DiffResponse
	// What a save of the right side is checked against; "" when the file is gone.
	Hash string `json:"hash,omitempty"`
	// The file has changed since the turn ended, and the right side holds those changes too.
	ChangedSince bool `json:"changedSince,omitempty"`
}

// Diff is one file a turn changed, as it was before the turn and as it is now.
func (c *Chat) Diff(ctx context.Context, number int, path string) (TurnDiff, error) {
	found, err := c.turnChanges(number)
	if err != nil {
		return TurnDiff{}, err
	}
	for _, change := range found.changes {
		if change.Path != path {
			continue
		}
		var before []byte
		if change.Before != "" {
			if before, err = c.checkpoints.Blob(ctx, change.Before); err != nil {
				return TurnDiff{}, err
			}
		}
		now, exists, err := c.checkpoints.Read(path)
		if err != nil {
			return TurnDiff{}, err
		}
		blob, err := c.checkpoints.Hash(ctx, path)
		if err != nil {
			return TurnDiff{}, err
		}
		diff := TurnDiff{DiffResponse: gitclient.Compare(path, before, now), ChangedSince: blob != change.After}
		if exists {
			sum := sha256.Sum256(now)
			diff.Hash = hex.EncodeToString(sum[:])
		}
		return diff, nil
	}
	return TurnDiff{}, fmt.Errorf("turn %d did not change %s", number, path)
}

// ChangedSince is the refusal of an undo whose files have changed after the turn: Paths are those files.
type ChangedSince struct{ Paths []string }

func (e *ChangedSince) Error() string {
	return fmt.Sprintf("%d of the files have changed since", len(e.Paths))
}

var errUndone = errors.New("those changes have already been put back")

/*
Undo puts files a turn changed back as they were before it: those at paths, or every one not put back
yet when there are none. A file that has changed after the turn is refused with ChangedSince unless
anyway is set, which puts it back regardless.
*/
func (c *Chat) Undo(ctx context.Context, number int, anyway bool, paths ...string) error {
	found, err := c.turnChanges(number)
	if err != nil {
		return err
	}
	wanted := map[string]bool{}
	for _, path := range paths {
		wanted[path] = true
	}
	c.mu.Lock()
	busy := c.answering
	var undoing []checkpoint.Change
	for _, change := range found.changes {
		if !found.undone[change.Path] && (len(paths) == 0 || wanted[change.Path]) {
			undoing = append(undoing, change)
		}
	}
	c.mu.Unlock()
	switch {
	case busy:
		return ErrBusy
	case len(undoing) == 0:
		return errUndone
	}
	if !anyway {
		moved, err := c.checkpoints.Since(ctx, undoing)
		if err != nil {
			return err
		}
		if len(moved) > 0 {
			return &ChangedSince{Paths: moved}
		}
	}
	if err := c.checkpoints.Restore(ctx, undoing); err != nil {
		return err
	}
	c.mu.Lock()
	for _, change := range undoing {
		found.undone[change.Path] = true
	}
	c.mu.Unlock()
	c.record(Event{Type: "undone", Changes: &TurnChanges{Turn: number, Files: undoing}})
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
