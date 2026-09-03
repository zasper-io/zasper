package kernel

import (
	"fmt"
	"net"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// withNoAllocatedPorts empties the tracking list, which is one list per process.
func withNoAllocatedPorts(t *testing.T) {
	t.Helper()

	reset := func() {
		portMutex.Lock()
		defer portMutex.Unlock()
		currentlyUsedPorts = nil
	}
	t.Cleanup(reset)
	reset()
}

// A kernel needs five ports and gets none of them if the check for "is this port free" can fail for a
// reason that has nothing to do with the port. The version this replaced bound 127.0.0.1:P, held that
// listener open, and then tried to bind :P — which Linux refuses with EADDRINUSE because of the
// listener it had just opened itself. Every port in its range failed, on every attempt, and no kernel
// could start; macOS allows the overlapping bind, so it only ever showed up in CI.
func TestFindAvailablePortGivesOutPortsThatCanBeBound(t *testing.T) {
	withNoAllocatedPorts(t)

	seen := map[int]bool{}
	for i := 0; i < 20; i++ {
		port, err := findAvailablePort()
		require.NoError(t, err)
		require.NotZero(t, port, "a zero port would be written into the connection file")

		assert.False(t, seen[port], "port %d was handed out twice", port)
		seen[port] = true

		// What the kernel process does with it a moment later.
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		require.NoError(t, err, "port %d was offered but cannot be bound", port)
		require.NoError(t, listener.Close())
	}
}

func TestFindAvailablePortIsSafeForConcurrentKernelStarts(t *testing.T) {
	withNoAllocatedPorts(t)

	const starts = 10
	ports := make([]int, starts)
	var waiter sync.WaitGroup
	for i := range ports {
		waiter.Add(1)
		go func() {
			defer waiter.Done()
			port, err := findAvailablePort()
			assert.NoError(t, err)
			ports[i] = port
		}()
	}
	waiter.Wait()

	assert.Len(t, seenOnce(ports), starts, "two kernels were given the same port: %v", ports)
}

func TestReleasePortPutsItBackOnOffer(t *testing.T) {
	withNoAllocatedPorts(t)

	port, err := findAvailablePort()
	require.NoError(t, err)
	assert.True(t, portExists(port))

	releasePort(port)
	assert.False(t, portExists(port), "a stopped kernel's port stays claimed for the life of the server")
}

func seenOnce(ports []int) map[int]bool {
	unique := map[int]bool{}
	for _, port := range ports {
		unique[port] = true
	}
	return unique
}
