//go:build unix

// These turns change files by running commands under /bin/sh.

package agents

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
	last := events[len(events)-1]
	assert.Equal(t, "undone", last.Type)
	assert.Equal(t, 2, last.Changes.Turn)
	assert.Equal(t, []string{"notes.txt"}, paths(last.Changes.Files))
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

func TestOneFileOfATurnIsPutBackOnItsOwn(t *testing.T) {
	_, chat, files := fakeChat(t)
	require.NoError(t, chat.Prompt("run echo a > a.txt; echo b > b.txt"))
	waitFor(t, chat, turnEnded)

	require.NoError(t, chat.Undo(context.Background(), 1, false, "a.txt"))

	assert.NoFileExists(t, filepath.Join(files.root, "a.txt"))
	assert.FileExists(t, filepath.Join(files.root, "b.txt"))
	assert.ErrorIs(t, chat.Undo(context.Background(), 1, false, "a.txt"), errUndone)

	require.NoError(t, chat.Undo(context.Background(), 1, false))
	assert.NoFileExists(t, filepath.Join(files.root, "b.txt"))
	assert.ErrorIs(t, chat.Undo(context.Background(), 1, false), errUndone)
}
