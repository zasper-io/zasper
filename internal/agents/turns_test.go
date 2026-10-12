package agents

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestATurnSaysWhichFilesItChangedHoweverItChangedThem(t *testing.T) {
	_, chat, files := fakeChat(t)
	require.NoError(t, os.WriteFile(filepath.Join(files.root, "old.txt"), []byte("old\n"), 0o644))

	require.NoError(t, chat.Prompt("write"))
	waitFor(t, chat, turnEnded)
	require.NoError(t, chat.Prompt("run echo made > made.txt; rm old.txt"))
	events := waitFor(t, chat, turnsEnded(chat, 2))

	assert.Equal(t, map[int][]string{
		1: {"A notes.txt"},
		2: {"A made.txt", "D old.txt"},
	}, turnChangesIn(events))
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
	_, err = chat.Diff(context.Background(), 1, "untouched.txt")
	assert.Error(t, err)
}

func TestUndoingATurnPutsItsFilesBack(t *testing.T) {
	_, chat, files := fakeChat(t)
	notes := filepath.Join(files.root, "notes.txt")
	require.NoError(t, os.WriteFile(notes, []byte("mine\n"), 0o644))
	require.NoError(t, chat.Prompt("run echo made > made.txt"))
	waitFor(t, chat, turnEnded)
	require.NoError(t, chat.Prompt("write"))
	waitFor(t, chat, turnsEnded(chat, 2))

	require.NoError(t, chat.Undo(context.Background(), 2, false))

	data, err := os.ReadFile(notes)
	require.NoError(t, err)
	assert.Equal(t, "mine\n", string(data))
	assert.FileExists(t, filepath.Join(files.root, "made.txt"), "an earlier turn was undone too")
	events := chatEvents(chat)
	assert.Equal(t, Event{Seq: len(events), Type: "undone", Changes: &TurnChanges{Turn: 2}}, events[len(events)-1])
	assert.ErrorIs(t, chat.Undo(context.Background(), 2, false), errUndone)
}

func TestAnUndoOverAFileChangedSinceIsAskedFirst(t *testing.T) {
	_, chat, files := fakeChat(t)
	require.NoError(t, chat.Prompt("run echo made > made.txt"))
	waitFor(t, chat, turnEnded)
	made := filepath.Join(files.root, "made.txt")
	require.NoError(t, os.WriteFile(made, []byte("edited after\n"), 0o644))

	err := chat.Undo(context.Background(), 1, false)

	var since *ChangedSince
	require.ErrorAs(t, err, &since)
	assert.Equal(t, []string{"made.txt"}, since.Paths)
	assert.FileExists(t, made)

	require.NoError(t, chat.Undo(context.Background(), 1, true))
	assert.NoFileExists(t, made)
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
