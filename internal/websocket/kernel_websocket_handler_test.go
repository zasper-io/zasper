package websocket

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zasper-io/zasper/internal/kernel"
)

func withKernelConnections(t *testing.T) {
	t.Helper()

	t.Cleanup(SetUpKernelConnections)
	SetUpKernelConnections()
}

func TestClosingAKernelsConnectionsTakesItOutOfTheStore(t *testing.T) {
	withKernelConnections(t)

	stopped := 0
	setKernelConnection("k1", &kernel.KernelWebSocketConnection{PollingCancel: func() { stopped++ }})

	CloseKernelConnections("k1")
	assert.Equal(t, 1, stopped)

	// Gone, so a second kernel-stopped notification for the same kernel has nothing left to close.
	CloseKernelConnections("k1")
	assert.Equal(t, 1, stopped)
}

func TestClosingAKernelWithNoConnectionDoesNothing(t *testing.T) {
	withKernelConnections(t)

	CloseKernelConnections("k1")

	_, ok := removeKernelConnection("k1")
	assert.False(t, ok)
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
				setKernelConnection(kernelId, &kernel.KernelWebSocketConnection{PollingCancel: func() {}})
				if i%3 == 0 {
					CloseKernelConnections(kernelId)
				} else {
					removeKernelConnection(kernelId)
				}
			}
		}(worker)
	}

	running.Wait()
}
