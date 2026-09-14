package kernel

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testKernels answers kernels with a manager stored under each id and no process behind any of them, and
// runs the test in parallel.
func testKernels(t *testing.T, ids ...string) *Kernels {
	t.Helper()
	t.Parallel()

	k := New(nil)
	for _, id := range ids {
		k.running.Set(id, &KernelManager{KernelId: id, KernelName: "python3"})
	}
	return k
}

func TestAKernelIsFoundByItsIdAndOnlyThat(t *testing.T) {
	k := testKernels(t, "k1")

	km, ok := k.Get("k1")
	assert.True(t, ok)
	assert.Equal(t, "python3", km.KernelName)

	_, ok = k.Get("k2")
	assert.False(t, ok)
}

func TestTakingAKernelOnlyAnswersOnceForTheSameKernel(t *testing.T) {
	k := testKernels(t, "k1")

	km, ok := k.take("k1")
	assert.True(t, ok)
	assert.Equal(t, "k1", km.KernelId)

	// What stops two callers stopping the same kernel from both signalling its pid.
	_, ok = k.take("k1")
	assert.False(t, ok)
}

// Sessions are told before sockets, so a client told its socket has closed finds no session to rejoin.
func TestStoppingAKernelTellsWhatDependsOnItInOrder(t *testing.T) {
	k := testKernels(t, "k1")
	var told []string
	k.OnDisconnect(func(id string) { told = append(told, "sessions "+id) })
	k.OnDisconnect(func(id string) { told = append(told, "sockets "+id) })

	require.NoError(t, k.Stop("k1"))
	assert.Equal(t, []string{"sessions k1", "sockets k1"}, told)

	assert.ErrorIs(t, k.Stop("k1"), ErrKernelNotFound)
	assert.Len(t, told, 2, "a kernel that was already stopped was reported again")
}

func TestTheListReportsEveryRunningKernel(t *testing.T) {
	k := testKernels(t, "k1", "k2")

	ids := []string{}
	for _, kernel := range k.list() {
		ids = append(ids, kernel.Id)
		assert.Equal(t, "python3", kernel.Name)
	}
	assert.ElementsMatch(t, []string{"k1", "k2"}, ids)
}

func TestAKernelThatIsNotRunningIsNotFound(t *testing.T) {
	k := testKernels(t)

	_, err := k.model("k1")
	assert.ErrorIs(t, err, ErrKernelNotFound)
}

func TestInterruptRefusesRatherThanSignallingNothingInParticular(t *testing.T) {
	k := testKernels(t, "k1")

	// A manager that never launched has no process, and SIGINT to its zero pid would go to every process
	// in this process group, the server included. Returning here is the assertion: nothing was signalled.
	assert.ErrorIs(t, k.interrupt("k2"), ErrKernelNotFound)
	assert.ErrorContains(t, k.interrupt("k1"), "no process")
}

func TestRecordingActivityWritesWhatTheApiReports(t *testing.T) {
	k := testKernels(t, "k1")
	km, _ := k.Get("k1")

	km.recordActivity("busy")

	lastActivity, executionState, _ := km.Status()
	assert.Equal(t, "busy", executionState)
	// RFC 3339 and nothing else: the browser reads this with `new Date`.
	when, err := time.Parse(time.RFC3339, lastActivity)
	assert.NoError(t, err)
	assert.WithinDuration(t, time.Now(), when, time.Minute)
}

func TestActivityWithNoStateLeavesTheLastOneStanding(t *testing.T) {
	k := testKernels(t, "k1")
	km, _ := k.Get("k1")

	km.recordActivity("busy")
	// A stream message, an execute_result, a display_data: the kernel is talking, and none of them says
	// what it is doing. Blanking the state on one of those would leave a running cell showing idle.
	km.recordActivity("")

	_, executionState, _ := km.Status()
	assert.Equal(t, "busy", executionState)
}

// A count in flight when the kernel was killed must not put the kernel back in the store.
func TestConnectionsAreNotRecordedAgainstAKernelThatHasStopped(t *testing.T) {
	k := testKernels(t)

	k.SetConnections("k1", 1)

	assert.Empty(t, k.list())
}

func TestConnectionsCountsWhatTheWebsocketLayerReports(t *testing.T) {
	k := testKernels(t, "k1")
	km, _ := k.Get("k1")

	k.SetConnections("k1", 1)
	_, _, connections := km.Status()
	assert.Equal(t, 1, connections)

	// A browser tab that closed. The kernel stays, which is the whole point of this panel.
	k.SetConnections("k1", 0)
	_, _, connections = km.Status()
	assert.Equal(t, 0, connections)
}

// Every kernel's activity watcher, the websocket layer and the API reach the store and each kernel's
// activity at once; -race is what this relies on.
func TestTheKernelStoreHoldsUpWhenEverythingReachesItAtOnce(t *testing.T) {
	k := testKernels(t)

	const workers = 8
	const each = 200
	var running sync.WaitGroup

	for worker := 0; worker < workers; worker++ {
		running.Add(1)
		go func(worker int) {
			defer running.Done()
			for i := 0; i < each; i++ {
				id := fmt.Sprintf("%d-%d", worker, i)
				km := &KernelManager{KernelId: id, KernelName: "python3"}
				k.running.Set(id, km)
				k.Get(id)
				k.list()
				km.recordActivity("busy")
				k.SetConnections(id, 1)
				if _, err := k.model(id); err != nil && !errors.Is(err, ErrKernelNotFound) {
					t.Errorf("unexpected error: %v", err)
				}
				if i%3 == 0 {
					k.take(id)
				}
			}
		}(worker)
	}

	running.Wait()
	assert.NotNil(t, k.list())
}
