package kernel

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func withKernels(t *testing.T, ids ...string) {
	t.Helper()

	// One store per process, so a test that left its kernels behind would be the next one's starting
	// point.
	t.Cleanup(SetUpStateKernels)

	SetUpStateKernels()
	for _, id := range ids {
		setActiveKernel(id, &KernelManager{KernelId: id, KernelName: "python3"})
	}
}

func TestActiveKernelFindsARunningKernelAndOnlyThat(t *testing.T) {
	withKernels(t, "k1")

	km, ok := ActiveKernel("k1")
	assert.True(t, ok)
	assert.Equal(t, "python3", km.KernelName)

	_, ok = ActiveKernel("k2")
	assert.False(t, ok)
}

func TestSetUpStateKernelsEmptiesTheStore(t *testing.T) {
	withKernels(t, "k1")

	SetUpStateKernels()

	assert.Empty(t, activeKernels())
}

func TestRemoveActiveKernelOnlyAnswersOnceForTheSameKernel(t *testing.T) {
	withKernels(t, "k1")

	km, ok := removeActiveKernel("k1")
	assert.True(t, ok)
	assert.Equal(t, "k1", km.KernelId)

	// What stops two callers stopping the same kernel from both signalling its pid.
	_, ok = removeActiveKernel("k1")
	assert.False(t, ok)
}

func TestListKernelsReportsEveryRunningKernel(t *testing.T) {
	withKernels(t, "k1", "k2")

	listed, err := listKernels()
	assert.NoError(t, err)

	ids := []string{}
	for _, kernel := range listed {
		ids = append(ids, kernel.Id)
		assert.Equal(t, "python3", kernel.Name)
	}
	assert.ElementsMatch(t, []string{"k1", "k2"}, ids)
}

func TestGetKernelSaysSoWhenTheKernelIsNotRunning(t *testing.T) {
	withKernels(t)

	_, err := getKernel("k1")
	assert.ErrorIs(t, err, ErrKernelNotFound)
}

func TestInterruptKernelRefusesRatherThanSignallingNothingInParticular(t *testing.T) {
	withKernels(t, "k1")

	// A manager that never launched has no process, and SIGINT to its zero pid would go to every process
	// in this process group, the server included. Returning here is the assertion: nothing was signalled.
	assert.ErrorIs(t, interruptKernel("k2"), ErrKernelNotFound)
	assert.ErrorContains(t, interruptKernel("k1"), "no process")
}

func TestRecordingActivityWritesWhatTheApiReports(t *testing.T) {
	withKernels(t, "k1")

	recordKernelActivity("k1", "busy")

	km, _ := ActiveKernel("k1")
	lastActivity, executionState, _ := km.Status()
	assert.Equal(t, "busy", executionState)
	// RFC 3339 and nothing else: the browser reads this with `new Date`.
	when, err := time.Parse(time.RFC3339, lastActivity)
	assert.NoError(t, err)
	assert.WithinDuration(t, time.Now(), when, time.Minute)
}

func TestActivityWithNoStateLeavesTheLastOneStanding(t *testing.T) {
	withKernels(t, "k1")

	recordKernelActivity("k1", "busy")
	// A stream message, an execute_result, a display_data: the kernel is talking, and none of them says
	// what it is doing. Blanking the state on one of those would leave a running cell showing idle.
	recordKernelActivity("k1", "")

	km, _ := ActiveKernel("k1")
	_, executionState, _ := km.Status()
	assert.Equal(t, "busy", executionState)
}

func TestNothingIsRecordedAgainstAKernelThatHasStopped(t *testing.T) {
	withKernels(t)

	// A message in flight when the kernel was killed must not put the kernel back in the store.
	recordKernelActivity("k1", "idle")
	SetKernelConnections("k1", 1)

	assert.Empty(t, activeKernels())
}

func TestConnectionsCountsWhatTheWebsocketLayerReports(t *testing.T) {
	withKernels(t, "k1")
	km, _ := ActiveKernel("k1")

	SetKernelConnections("k1", 1)
	_, _, connections := km.Status()
	assert.Equal(t, 1, connections)

	// A browser tab that closed. The kernel stays, which is the whole point of this panel.
	SetKernelConnections("k1", 0)
	_, _, connections = km.Status()
	assert.Equal(t, 0, connections)
}

// Every kernel's activity watcher, the websocket layer and the API reach the store and each kernel's
// activity at once; -race is what this relies on.
func TestTheKernelStoreHoldsUpWhenEverythingReachesItAtOnce(t *testing.T) {
	withKernels(t)

	const workers = 8
	const each = 200
	var running sync.WaitGroup

	for worker := 0; worker < workers; worker++ {
		running.Add(1)
		go func(worker int) {
			defer running.Done()
			for i := 0; i < each; i++ {
				id := fmt.Sprintf("%d-%d", worker, i)
				setActiveKernel(id, &KernelManager{KernelId: id, KernelName: "python3"})
				ActiveKernel(id)
				activeKernels()
				recordKernelActivity(id, "busy")
				SetKernelConnections(id, 1)
				if _, err := getKernel(id); err != nil && !errors.Is(err, ErrKernelNotFound) {
					t.Errorf("unexpected error: %v", err)
				}
				if i%3 == 0 {
					removeActiveKernel(id)
				}
			}
		}(worker)
	}

	running.Wait()
	assert.NotNil(t, activeKernels())
}
