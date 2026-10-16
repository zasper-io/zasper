package agents

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/checkpoint"
)

// turnChangesIn is what the log says turns changed, by turn. The file the fake agent writes as its
// session starts is left out: whether the first snapshot sees it is a race.
func turnChangesIn(events []Event) map[int][]string {
	changed := map[int][]string{}
	for _, event := range events {
		if event.Type == "changes" {
			for _, file := range event.Changes.Files {
				if file.Path != "mcp-servers.txt" {
					changed[event.Changes.Turn] = append(changed[event.Changes.Turn], file.Status+" "+file.Path)
				}
			}
		}
	}
	return changed
}

// turnsEnded matches the event that ends the nth turn.
func turnsEnded(chat *Chat, n int) func(Event) bool {
	return func(event Event) bool {
		ended := 0
		for _, seen := range chatEvents(chat) {
			if seen.Type == "turn_end" {
				ended++
			}
		}
		return turnEnded(event) && ended >= n
	}
}

func TestATurnThatChangedNothingSaysNothing(t *testing.T) {
	_, chat, _ := fakeChat(t)
	require.NoError(t, chat.Prompt("hello"))
	waitFor(t, chat, turnEnded)
	require.NoError(t, chat.Prompt("hello"))
	events := waitFor(t, chat, turnsEnded(chat, 2))

	assert.Empty(t, turnChangesIn(events))
}

func TestAFileATurnChangedIsShownBeforeAndAfter(t *testing.T) {
	_, chat, files := fakeChat(t)
	require.NoError(t, os.WriteFile(filepath.Join(files.root, "notes.txt"), []byte("mine\n"), 0o644))
	require.NoError(t, chat.Prompt("write"))
	waitFor(t, chat, turnEnded)

	diff, err := chat.Diff(context.Background(), 1, "notes.txt")
	require.NoError(t, err)
	assert.Equal(t, "mine\n", diff.Original)
	assert.Equal(t, "written by the agent\n", diff.Modified)
	assert.False(t, diff.ChangedSince)
	assert.Equal(t, sha256Hex("written by the agent\n"), diff.Hash, "not the hash a save is checked against")

	// The right side is the file as it is now, so putting back one part composes with the next.
	require.NoError(t, os.WriteFile(filepath.Join(files.root, "notes.txt"), []byte("edited since\n"), 0o644))
	diff, err = chat.Diff(context.Background(), 1, "notes.txt")
	require.NoError(t, err)
	assert.Equal(t, "edited since\n", diff.Modified)
	assert.True(t, diff.ChangedSince)
	_, err = chat.Diff(context.Background(), 1, "untouched.txt")
	assert.Error(t, err)
}

func TestAChatLetsGoOfItsTurnsSnapshotsWhenItStops(t *testing.T) {
	manager, chat, _ := fakeChat(t)
	require.NoError(t, chat.Prompt("write"))
	waitFor(t, chat, turnEnded)
	pinned := func() string {
		refs, err := exec.Command("git", "--git-dir="+chat.checkpoints.Dir(), "for-each-ref", "--format=%(refname)").Output()
		require.NoError(t, err)
		return string(refs)
	}
	assert.Contains(t, pinned(), chat.ID+"/1/before")
	assert.Contains(t, pinned(), chat.ID+"/1/after")

	manager.Stop(chat.ID)

	assert.Empty(t, pinned())
}

func paths(changes []checkpoint.Change) []string {
	var found []string
	for _, change := range changes {
		found = append(found, change.Path)
	}
	return found
}

func sha256Hex(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}
