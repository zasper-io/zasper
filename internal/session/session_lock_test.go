package session

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestSessionsForOneNotebookAreCreatedOneAtATime(t *testing.T) {
	s := testSessions(t)
	unlock := s.lockPath("a.ipynb")

	other := make(chan struct{})
	go func() {
		defer s.lockPath("b.ipynb")()
		close(other)
	}()
	select {
	case <-other:
	case <-time.After(time.Second):
		t.Fatal("a different notebook waited for the lock")
	}

	same := make(chan struct{})
	go func() {
		defer s.lockPath("a.ipynb")()
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
		s.pathLocks.mu.Lock()
		defer s.pathLocks.mu.Unlock()
		return len(s.pathLocks.held) == 0
	}, time.Second, 10*time.Millisecond, "a lock nobody holds was kept")
}
