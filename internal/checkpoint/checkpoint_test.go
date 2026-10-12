package checkpoint

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// project makes a project with a few files and a store for it, kept under a home of the test's own.
func project(t *testing.T) (*Store, string) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	root := t.TempDir()
	write(t, root, "a.py", "a = 1\n")
	write(t, root, "data/b.csv", "x\n1\n")
	write(t, root, "gone.txt", "bye\n")
	store, err := For(root)
	require.NoError(t, err)
	return store, root
}

func write(t *testing.T, root, path, text string) {
	t.Helper()
	full := filepath.Join(root, path)
	require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
	require.NoError(t, os.WriteFile(full, []byte(text), 0o644))
}

func read(t *testing.T, root, path string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, path))
	require.NoError(t, err)
	return string(data)
}

func TestTheChangesBetweenTwoSnapshotsAreListed(t *testing.T) {
	store, root := project(t)
	ctx := context.Background()
	before, err := store.Snapshot(ctx, "")
	require.NoError(t, err)

	write(t, root, "a.py", "a = 2\n")
	write(t, root, "new/c.py", "c = 3\n")
	require.NoError(t, os.Remove(filepath.Join(root, "gone.txt")))
	after, err := store.Snapshot(ctx, "")
	require.NoError(t, err)

	changes, err := store.Changes(ctx, before, after)
	require.NoError(t, err)
	var listed []string
	for _, change := range changes {
		listed = append(listed, change.Status+" "+change.Path)
	}
	assert.Equal(t, []string{"M a.py", "D gone.txt", "A new/c.py"}, listed)
	old, err := store.Blob(ctx, changes[0].Before)
	require.NoError(t, err)
	assert.Equal(t, "a = 1\n", string(old))
}

func TestNothingChangedIsNoChange(t *testing.T) {
	store, _ := project(t)
	ctx := context.Background()
	before, err := store.Snapshot(ctx, "")
	require.NoError(t, err)
	after, err := store.Snapshot(ctx, "")
	require.NoError(t, err)

	changes, err := store.Changes(ctx, before, after)
	require.NoError(t, err)
	assert.Empty(t, changes)
}

func TestRestoringPutsTheFilesBackAsTheyWere(t *testing.T) {
	store, root := project(t)
	ctx := context.Background()
	before, err := store.Snapshot(ctx, "")
	require.NoError(t, err)
	write(t, root, "a.py", "a = 2\n")
	write(t, root, "new/c.py", "c = 3\n")
	require.NoError(t, os.Remove(filepath.Join(root, "gone.txt")))
	after, err := store.Snapshot(ctx, "")
	require.NoError(t, err)
	changes, err := store.Changes(ctx, before, after)
	require.NoError(t, err)

	moved, err := store.Since(ctx, changes)
	require.NoError(t, err)
	assert.Empty(t, moved)
	require.NoError(t, store.Restore(ctx, changes))

	assert.Equal(t, "a = 1\n", read(t, root, "a.py"))
	assert.Equal(t, "bye\n", read(t, root, "gone.txt"))
	assert.NoFileExists(t, filepath.Join(root, "new/c.py"))
}

func TestAFileChangedSinceIsNamed(t *testing.T) {
	store, root := project(t)
	ctx := context.Background()
	before, err := store.Snapshot(ctx, "")
	require.NoError(t, err)
	write(t, root, "a.py", "a = 2\n")
	after, err := store.Snapshot(ctx, "")
	require.NoError(t, err)
	changes, err := store.Changes(ctx, before, after)
	require.NoError(t, err)

	write(t, root, "a.py", "a = 3\n")

	moved, err := store.Since(ctx, changes)
	require.NoError(t, err)
	assert.Equal(t, []string{"a.py"}, moved)
}

func TestIgnoredSkippedAndLargeFilesAreNotKept(t *testing.T) {
	store, root := project(t)
	ctx := context.Background()
	write(t, root, ".gitignore", "*.log\n")
	before, err := store.Snapshot(ctx, "")
	require.NoError(t, err)

	write(t, root, "run.log", "noise\n")
	write(t, root, "node_modules/x/index.js", "x\n")
	write(t, root, ".zasper/state.json", "{}\n")
	big, err := os.Create(filepath.Join(root, "big.bin"))
	require.NoError(t, err)
	require.NoError(t, big.Truncate(maxFileBytes+1))
	big.Close()
	after, err := store.Snapshot(ctx, "")
	require.NoError(t, err)

	changes, err := store.Changes(ctx, before, after)
	require.NoError(t, err)
	assert.Empty(t, changes)
}

func TestTheProjectsOwnRepositoryIsLeftAlone(t *testing.T) {
	store, root := project(t)
	git := func(args ...string) string {
		out, err := exec.Command("git", append([]string{"-C", root}, args...)...).CombinedOutput()
		require.NoError(t, err, string(out))
		return string(out)
	}
	git("init", "--quiet")
	git("add", "a.py")
	status := git("status", "--porcelain")

	_, err := store.Snapshot(context.Background(), "")
	require.NoError(t, err)
	write(t, root, "a.py", "a = 2\n")
	_, err = store.Snapshot(context.Background(), "")
	require.NoError(t, err)
	write(t, root, "a.py", "a = 1\n")

	assert.Equal(t, status, git("status", "--porcelain"))
}

// exists says whether the store still holds an object.
func exists(store *Store, object string) bool {
	_, err := store.run(context.Background(), nil, "cat-file", "-e", object)
	return err == nil
}

func TestAPinnedSnapshotIsKeptUntilReleased(t *testing.T) {
	store, root := project(t)
	ctx := context.Background()
	pinned, err := store.Snapshot(ctx, "chat-1/1/before")
	require.NoError(t, err)
	write(t, root, "a.py", "a = 2\n")
	loose, err := store.Snapshot(ctx, "")
	require.NoError(t, err)
	write(t, root, "a.py", "a = 3\n")
	_, err = store.Snapshot(ctx, "chat-2/1/before")
	require.NoError(t, err)

	require.NoError(t, store.Release(ctx, "chat-2"))

	assert.True(t, exists(store, pinned), "another chat's snapshot went")
	assert.False(t, exists(store, loose), "a snapshot nothing pins was kept")

	require.NoError(t, store.Release(ctx, "chat-1"))
	assert.False(t, exists(store, pinned))
}

func TestTheSnapshotsOfAServerNoLongerRunningAreDropped(t *testing.T) {
	store, _ := project(t)
	ctx := context.Background()
	tree, err := store.Snapshot(ctx, "")
	require.NoError(t, err)
	// What a server that crashed leaves behind: pins under a pid nothing runs as.
	_, err = store.run(ctx, nil, "update-ref", "refs/zasper/999999999/chat/1/before", tree)
	require.NoError(t, err)

	again, err := For(store.root)
	require.NoError(t, err)
	again.inited = false
	_, err = again.Snapshot(ctx, "")
	require.NoError(t, err)

	refs, err := store.run(ctx, nil, "for-each-ref", "refs/zasper/")
	require.NoError(t, err)
	assert.Empty(t, string(refs))
}

func TestTheStoresOfProjectsLongUnusedAreRemoved(t *testing.T) {
	dir := t.TempDir()
	old, recent, keep := filepath.Join(dir, "old"), filepath.Join(dir, "recent"), filepath.Join(dir, "keep")
	for _, store := range []string{old, recent, keep} {
		require.NoError(t, os.MkdirAll(store, 0o700))
		write(t, store, "index", "")
	}
	longAgo := time.Now().Add(-staleAfter - time.Hour)
	require.NoError(t, os.Chtimes(filepath.Join(old, "index"), longAgo, longAgo))
	require.NoError(t, os.Chtimes(filepath.Join(keep, "index"), longAgo, longAgo))

	sweep(dir, keep)

	assert.NoDirExists(t, old)
	assert.DirExists(t, recent)
	assert.DirExists(t, keep)
}
