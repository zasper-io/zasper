package content

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// subscribe starts the project watch afresh for a test, and ends it when the test does.
func subscribe(t *testing.T) *watchSubscriber {
	t.Helper()

	SetUpActiveWatcherConnections()
	t.Cleanup(SetUpActiveWatcherConnections)

	subscriber, err := watch.subscribe()
	require.NoError(t, err)
	t.Cleanup(func() { watch.unsubscribe(subscriber) })
	return subscriber
}

// settle waits until changes already made have been reported, so the next change heard is a new one.
func settle(subscriber *watchSubscriber) {
	for {
		select {
		case <-subscriber.changed:
		case <-time.After(300 * time.Millisecond):
			return
		}
	}
}

// hears keeps writing to path until the subscriber is told of a change, and says whether that happened
// within the time. The writes keep coming because a folder's watch is added a moment after the walk
// reaches it.
func hears(subscriber *watchSubscriber, path string, within time.Duration) bool {
	deadline := time.After(within)
	tick := time.NewTicker(50 * time.Millisecond)
	defer tick.Stop()

	for i := 0; ; i++ {
		os.WriteFile(path, []byte(strconv.Itoa(i)), 0o644)
		select {
		case <-subscriber.changed:
			return true
		case <-deadline:
			return false
		case <-tick.C:
		}
	}
}

func TestChangesInAFolderCreatedLaterAreHeard(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	subscriber := subscribe(t)
	settle(subscriber)

	nested := filepath.Join(projectDir, "later", "deeper")
	require.NoError(t, os.MkdirAll(nested, 0o755))
	settle(subscriber)

	assert.True(t, hears(subscriber, filepath.Join(nested, "notes.txt"), 5*time.Second))
}

func TestIgnoredFoldersAreNotWatchedButOrdinaryOnesAre(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	require.NoError(t, os.WriteFile(filepath.Join(projectDir, ".gitignore"), []byte("build/\n"), 0o644))
	for _, dir := range []string{"build", "node_modules", "tests"} {
		require.NoError(t, os.MkdirAll(filepath.Join(projectDir, dir), 0o755))
	}
	subscriber := subscribe(t)
	settle(subscriber)

	assert.False(t, hears(subscriber, filepath.Join(projectDir, "build", "out.txt"), time.Second),
		"a folder .gitignore ignores was watched")
	assert.False(t, hears(subscriber, filepath.Join(projectDir, "node_modules", "index.js"), time.Second),
		"node_modules was watched")
	assert.True(t, hears(subscriber, filepath.Join(projectDir, "tests", "test_notes.py"), 5*time.Second),
		"a folder called tests was not watched")
}

func TestAnUnreadableFolderDoesNotStopTheRestBeingWatched(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs a folder the test cannot read")
	}
	projectDir := projectDirElsewhere(t)
	locked := filepath.Join(projectDir, "a-locked")
	open := filepath.Join(projectDir, "z-open")
	require.NoError(t, os.MkdirAll(locked, 0o755))
	require.NoError(t, os.MkdirAll(open, 0o755))
	require.NoError(t, os.Chmod(locked, 0))
	t.Cleanup(func() { os.Chmod(locked, 0o755) })

	subscriber := subscribe(t)
	settle(subscriber)

	assert.True(t, hears(subscriber, filepath.Join(open, "notes.txt"), 5*time.Second))
}

func TestAFileRenamedOutOfTheProjectIsHeard(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	leaving := filepath.Join(projectDir, "leaving.txt")
	require.NoError(t, os.WriteFile(leaving, []byte("bye"), 0o644))
	subscriber := subscribe(t)
	settle(subscriber)

	require.NoError(t, os.Rename(leaving, filepath.Join(t.TempDir(), "leaving.txt")))

	select {
	case <-subscriber.changed:
	case <-time.After(5 * time.Second):
		t.Fatal("the rename was not heard")
	}
}

func TestOneWatcherServesEverySubscriber(t *testing.T) {
	projectDirElsewhere(t)
	first := subscribe(t)

	watch.mu.Lock()
	shared := watch.watcher
	watch.mu.Unlock()

	second, err := watch.subscribe()
	require.NoError(t, err)

	watch.mu.Lock()
	assert.Same(t, shared, watch.watcher, "a second subscriber started a watcher of its own")
	watch.mu.Unlock()

	watch.unsubscribe(second)
	watch.unsubscribe(first)

	watch.mu.Lock()
	defer watch.mu.Unlock()
	assert.Nil(t, watch.watcher, "the watcher outlived its last subscriber")
}

func TestASubscriberThatIsNotListeningHoldsNobodyUp(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	subscribe(t)
	listening, err := watch.subscribe()
	require.NoError(t, err)
	t.Cleanup(func() { watch.unsubscribe(listening) })
	settle(listening)

	for range 3 {
		assert.True(t, hears(listening, filepath.Join(projectDir, "notes.txt"), 5*time.Second))
	}
}
