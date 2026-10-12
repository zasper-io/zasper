package content

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// watchedProject makes a project and a watch over it, and runs the test in parallel.
func watchedProject(t *testing.T) (*projectWatch, string) {
	t.Helper()

	_, projectDir := testProject(t)
	return newProjectWatch(projectDir), projectDir
}

// subscribe adds a subscriber to watch until the test ends.
func subscribe(t *testing.T, watch *projectWatch) *watchSubscriber {
	t.Helper()

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
	watch, projectDir := watchedProject(t)
	subscriber := subscribe(t, watch)
	settle(subscriber)

	nested := filepath.Join(projectDir, "later", "deeper")
	require.NoError(t, os.MkdirAll(nested, 0o755))
	settle(subscriber)

	assert.True(t, hears(subscriber, filepath.Join(nested, "notes.txt"), 5*time.Second))
}

func TestIgnoredFoldersAreNotWatchedButOrdinaryOnesAre(t *testing.T) {
	watch, projectDir := watchedProject(t)
	require.NoError(t, os.WriteFile(filepath.Join(projectDir, ".gitignore"), []byte("build/\n"), 0o644))
	for _, dir := range []string{"build", "node_modules", "tests"} {
		require.NoError(t, os.MkdirAll(filepath.Join(projectDir, dir), 0o755))
	}
	subscriber := subscribe(t, watch)
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
	watch, projectDir := watchedProject(t)
	locked := filepath.Join(projectDir, "a-locked")
	open := filepath.Join(projectDir, "z-open")
	require.NoError(t, os.MkdirAll(locked, 0o755))
	require.NoError(t, os.MkdirAll(open, 0o755))
	require.NoError(t, os.Chmod(locked, 0))
	t.Cleanup(func() { os.Chmod(locked, 0o755) })

	subscriber := subscribe(t, watch)
	settle(subscriber)

	assert.True(t, hears(subscriber, filepath.Join(open, "notes.txt"), 5*time.Second))
}

func TestAFileRenamedOutOfTheProjectIsHeard(t *testing.T) {
	watch, projectDir := watchedProject(t)
	leaving := filepath.Join(projectDir, "leaving.txt")
	require.NoError(t, os.WriteFile(leaving, []byte("bye"), 0o644))
	subscriber := subscribe(t, watch)
	settle(subscriber)

	require.NoError(t, os.Rename(leaving, filepath.Join(t.TempDir(), "leaving.txt")))

	select {
	case <-subscriber.changed:
	case <-time.After(5 * time.Second):
		t.Fatal("the rename was not heard")
	}
}

func TestOneWatcherServesEverySubscriber(t *testing.T) {
	watch, _ := watchedProject(t)
	first := subscribe(t, watch)

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
	watch, projectDir := watchedProject(t)
	subscribe(t, watch)
	listening, err := watch.subscribe()
	require.NoError(t, err)
	t.Cleanup(func() { watch.unsubscribe(listening) })
	settle(listening)

	for range 3 {
		assert.True(t, hears(listening, filepath.Join(projectDir, "notes.txt"), 5*time.Second))
	}
}

// changes reads what the subscriber's client would be sent next.
func changes(t *testing.T, watch *projectWatch, subscriber *watchSubscriber) map[string]*string {
	t.Helper()

	var message watchMessage
	require.NoError(t, json.Unmarshal(watch.take(subscriber), &message))
	byPath := map[string]*string{}
	for _, change := range message.Changed {
		byPath[change.Path] = change.Hash
	}
	return byPath
}

func TestAChangeSaysWhichFile(t *testing.T) {
	watch, projectDir := watchedProject(t)
	require.NoError(t, os.MkdirAll(filepath.Join(projectDir, "data"), 0o755))
	subscriber := subscribe(t, watch)
	settle(subscriber)
	watch.take(subscriber)

	require.True(t, hears(subscriber, filepath.Join(projectDir, "data", "notes.txt"), 5*time.Second))
	time.Sleep(100 * time.Millisecond)

	reported := changes(t, watch, subscriber)
	assert.Contains(t, reported, "data/notes.txt")
	assert.Nil(t, reported["data/notes.txt"], "a file nobody has open was hashed")
}

func TestManyWritesToOneFileAreOneChange(t *testing.T) {
	watch, projectDir := watchedProject(t)
	subscriber := subscribe(t, watch)
	settle(subscriber)
	watch.take(subscriber)

	path := filepath.Join(projectDir, "notes.txt")
	for i := range 20 {
		require.NoError(t, os.WriteFile(path, []byte(strconv.Itoa(i)), 0o644))
	}
	settle(subscriber)

	assert.Equal(t, map[string]*string{"notes.txt": nil}, changes(t, watch, subscriber))
}

func TestAnOpenFileInAnIgnoredFolderIsReportedWithItsHash(t *testing.T) {
	watch, projectDir := watchedProject(t)
	require.NoError(t, os.WriteFile(filepath.Join(projectDir, ".gitignore"), []byte("scratch/\n"), 0o644))
	scratch := filepath.Join(projectDir, "scratch")
	require.NoError(t, os.MkdirAll(scratch, 0o755))
	subscriber := subscribe(t, watch)
	watch.want(subscriber, []string{"scratch/try.py"})
	settle(subscriber)
	watch.take(subscriber)

	assert.False(t, hears(subscriber, filepath.Join(scratch, "other.py"), time.Second),
		"a file nobody has open in an ignored folder was reported")
	watch.take(subscriber)

	require.True(t, hears(subscriber, filepath.Join(scratch, "try.py"), 5*time.Second))
	settle(subscriber)
	reported := changes(t, watch, subscriber)
	require.Contains(t, reported, "scratch/try.py")
	data, err := os.ReadFile(filepath.Join(scratch, "try.py"))
	require.NoError(t, err)
	assert.Equal(t, contentHash(data), *reported["scratch/try.py"])
}

func TestAnOpenFileThatIsDeletedIsReportedWithNoHash(t *testing.T) {
	watch, projectDir := watchedProject(t)
	path := filepath.Join(projectDir, "notes.txt")
	require.NoError(t, os.WriteFile(path, []byte("hello"), 0o644))
	subscriber := subscribe(t, watch)
	watch.want(subscriber, []string{"notes.txt"})
	settle(subscriber)
	watch.take(subscriber)

	require.NoError(t, os.Remove(path))
	settle(subscriber)

	reported := changes(t, watch, subscriber)
	require.Contains(t, reported, "notes.txt")
	assert.Equal(t, "", *reported["notes.txt"])
}

func TestTooManyChangesAreOneReload(t *testing.T) {
	watch, _ := watchedProject(t)
	subscriber := subscribe(t, watch)
	settle(subscriber)
	watch.take(subscriber)

	for i := range maxPendingPaths + 1 {
		watch.notify(fmt.Sprintf("site-packages/%d.py", i), "")
	}

	assert.Equal(t, "reload", string(watch.take(subscriber)))
	assert.Nil(t, watch.take(subscriber), "a reload left the paths before it pending")
}

func TestAPathOutsideTheProjectIsNotWatched(t *testing.T) {
	watch, _ := watchedProject(t)
	subscriber := subscribe(t, watch)

	watch.want(subscriber, []string{"../elsewhere.txt", "/etc/passwd", "notes.txt"})

	assert.Equal(t, map[string]struct{}{"notes.txt": {}}, subscriber.wants)
}
