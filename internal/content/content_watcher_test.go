package content

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestShouldExcludeMatchesFoldersRatherThanSubstrings(t *testing.T) {
	root := filepath.Join("/tmp", "my-project")

	// The project root is watched whatever it is called, which is what was broken: a project under
	// /tmp matched "tmp" and nothing in it was watched at all.
	assert.False(t, shouldExclude(root, root))
	assert.False(t, shouldExclude(root, filepath.Join(root, "src")))
	assert.False(t, shouldExclude(root, filepath.Join(root, "contests")), "not a folder named tests")
	assert.False(t, shouldExclude(root, filepath.Join(root, "distance")))

	assert.True(t, shouldExclude(root, filepath.Join(root, "node_modules")))
	assert.True(t, shouldExclude(root, filepath.Join(root, "ui", ".git")))
	assert.True(t, shouldExclude(root, filepath.Join(root, "tests")))
}

// openWatchers reads the store the way the store's own accessors do, since nothing in the package
// needs to and it is not worth an exported reader.
func openWatchers() int {
	watchers.mu.Lock()
	defer watchers.mu.Unlock()

	return len(watchers.by)
}

func TestWatchersAreAddedAndRemovedByWatchId(t *testing.T) {
	t.Cleanup(SetUpActiveWatcherConnections)
	SetUpActiveWatcherConnections()

	addWatcher("w1", &ContentWatchConnection{})
	addWatcher("w2", &ContentWatchConnection{})
	assert.Equal(t, 2, openWatchers())

	removeWatcher("w1")
	assert.Equal(t, 1, openWatchers())
}

// Every watch connection joins and leaves the store from its own goroutine. This used to be done
// under the connection's own mutex, one per connection, which guarded nothing shared: two clients
// connecting at once were a concurrent map write, and Go answers that by killing the server.
func TestTheWatcherStoreHoldsUpWhenEveryConnectionArrivesAtOnce(t *testing.T) {
	t.Cleanup(SetUpActiveWatcherConnections)
	SetUpActiveWatcherConnections()

	const workers = 8
	const each = 200
	var running sync.WaitGroup

	for worker := 0; worker < workers; worker++ {
		running.Add(1)
		go func(worker int) {
			defer running.Done()
			for i := 0; i < each; i++ {
				watchId := fmt.Sprintf("%d-%d", worker, i)
				addWatcher(watchId, &ContentWatchConnection{})
				openWatchers()
				if i%2 == 0 {
					removeWatcher(watchId)
				}
			}
		}(worker)
	}

	running.Wait()
	// Every other connection closed again, and each one is its own key, so the count is exact.
	assert.Equal(t, workers*each/2, openWatchers())
}
