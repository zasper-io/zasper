package kernelws

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

func withKernelConnections(t *testing.T) {
	t.Helper()

	t.Cleanup(SetUpKernelConnections)
	SetUpKernelConnections()
}

func TestClosingAKernelsConnectionsClosesEveryOneOfThem(t *testing.T) {
	withKernelConnections(t)

	stopped := 0
	addKernelConnection("k1", &Connection{PollingCancel: func() { stopped++ }})
	addKernelConnection("k1", &Connection{PollingCancel: func() { stopped++ }})

	CloseKernelConnections("k1")
	assert.Equal(t, 2, stopped)

	// Gone, so a second kernel-stopped notification for the same kernel has nothing left to close.
	CloseKernelConnections("k1")
	assert.Equal(t, 2, stopped)
}

func TestClosingAKernelWithNoConnectionDoesNothing(t *testing.T) {
	withKernelConnections(t)

	CloseKernelConnections("k1")

	assert.False(t, removeKernelConnection("k1", &Connection{}))
}

// A reloaded page's old connection finishing must not take the new one out with it.
func TestAConnectionThatEndsTakesOnlyItselfOut(t *testing.T) {
	withKernelConnections(t)

	oldStopped, newStopped := 0, 0
	old := &Connection{PollingCancel: func() { oldStopped++ }}
	current := &Connection{PollingCancel: func() { newStopped++ }}
	addKernelConnection("k1", old)
	addKernelConnection("k1", current)

	assert.True(t, removeKernelConnection("k1", old))
	assert.False(t, removeKernelConnection("k1", old))

	CloseKernelConnections("k1")
	assert.Equal(t, 0, oldStopped)
	assert.Equal(t, 1, newStopped)
}

// The store was an exported map guarded by a package-level mutex the caller had to remember to take.
// Every client connection and every kernel that stops reaches it, so it is exercised from several
// goroutines at once here; a concurrent map write would kill the process rather than fail the test.
func TestTheConnectionStoreHoldsUpWhenEverythingReachesItAtOnce(t *testing.T) {
	withKernelConnections(t)

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
				addKernelConnection(kernelId, connection)
				if i%3 == 0 {
					CloseKernelConnections(kernelId)
				} else {
					removeKernelConnection(kernelId, connection)
				}
			}
		}(worker)
	}

	running.Wait()
}
