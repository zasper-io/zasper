package session

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestSessionsForOneNotebookAreCreatedOneAtATime(t *testing.T) {
	unlock := lockPath("a.ipynb")

	other := make(chan struct{})
	go func() {
		defer lockPath("b.ipynb")()
		close(other)
	}()
	select {
	case <-other:
	case <-time.After(time.Second):
		t.Fatal("a different notebook waited for the lock")
	}

	same := make(chan struct{})
	go func() {
		defer lockPath("a.ipynb")()
		close(same)
	}()
	select {
	case <-same:
		t.Fatal("the same notebook did not wait for the lock")
	case <-time.After(100 * time.Millisecond):
	}

	unlock()
	select {
	case <-same:
	case <-time.After(time.Second):
		t.Fatal("the waiting request was never let in")
	}

	assert.Eventually(t, func() bool {
		pathLocks.mu.Lock()
		defer pathLocks.mu.Unlock()
		return len(pathLocks.held) == 0
	}, time.Second, 10*time.Millisecond, "a lock nobody holds was kept")
}
