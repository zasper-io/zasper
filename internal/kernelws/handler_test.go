package kernelws

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zasper-io/zasper/internal/kernel"
)

// testHandler answers a handler with no kernels running, and runs the test in parallel.
func testHandler(t *testing.T) *Handler {
	t.Helper()
	t.Parallel()

	return NewHandler(kernel.New(nil), nil)
}

func TestClosingAKernelsConnectionsClosesEveryOneOfThem(t *testing.T) {
	h := testHandler(t)

	stopped := 0
	h.addConnection("k1", &Connection{PollingCancel: func() { stopped++ }})
	h.addConnection("k1", &Connection{PollingCancel: func() { stopped++ }})

	h.CloseConnections("k1")
	assert.Equal(t, 2, stopped)

	// Gone, so a second kernel-stopped notification for the same kernel has nothing left to close.
	h.CloseConnections("k1")
	assert.Equal(t, 2, stopped)
}

func TestClosingAKernelWithNoConnectionDoesNothing(t *testing.T) {
	h := testHandler(t)

	h.CloseConnections("k1")

	assert.False(t, h.removeConnection("k1", &Connection{}))
}

// A reloaded page's old connection finishing must not take the new one out with it.
func TestAConnectionThatEndsTakesOnlyItselfOut(t *testing.T) {
	h := testHandler(t)

	oldStopped, newStopped := 0, 0
	old := &Connection{PollingCancel: func() { oldStopped++ }}
	current := &Connection{PollingCancel: func() { newStopped++ }}
	h.addConnection("k1", old)
	h.addConnection("k1", current)

	assert.True(t, h.removeConnection("k1", old))
	assert.False(t, h.removeConnection("k1", old))

	h.CloseConnections("k1")
	assert.Equal(t, 0, oldStopped)
	assert.Equal(t, 1, newStopped)
}

// Every client connection and every kernel that stops reaches the store, so it is exercised from several
// goroutines at once; -race is what this relies on.
func TestTheConnectionStoreHoldsUpWhenEverythingReachesItAtOnce(t *testing.T) {
	h := testHandler(t)

	const workers = 8
	const each = 200
	var running sync.WaitGroup

	for worker := 0; worker < workers; worker++ {
		running.Add(1)
		go func(worker int) {
			defer running.Done()
			for i := 0; i < each; i++ {
				kernelId := fmt.Sprintf("%d-%d", worker, i)
				connection := &Connection{PollingCancel: func() {}}
				h.addConnection(kernelId, connection)
				if i%3 == 0 {
					h.CloseConnections(kernelId)
				} else {
					h.removeConnection(kernelId, connection)
				}
			}
		}(worker)
	}

	running.Wait()
}
