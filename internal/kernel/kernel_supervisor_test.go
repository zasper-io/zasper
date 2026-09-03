package kernel

import (
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

func withKernels(t *testing.T, ids ...string) {
	t.Helper()

	// One store per process, so a test that left its kernels behind would be the next one's starting
	// point.
	t.Cleanup(SetUpStateKernels)

	SetUpStateKernels()
	for _, id := range ids {
		setActiveKernel(id, KernelManager{KernelId: id, KernelName: "python3"})
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

	// It used to answer nil and a model with nothing in it but the id it was handed, which the API
	// served as a 200.
	_, err := getKernel("k1")
	assert.ErrorIs(t, err, ErrKernelNotFound)
}

func TestInterruptKernelRefusesRatherThanSignallingNothingInParticular(t *testing.T) {
	withKernels(t, "k1")

	// Both of these used to reach os.FindProcess with the zero KernelManager's pid of 0, and SIGINT to
	// pid 0 goes to every process in this process group — the server included. Returning here is the
	// assertion: nothing was signalled.
	assert.ErrorIs(t, interruptKernel("k2"), ErrKernelNotFound)
	assert.ErrorContains(t, interruptKernel("k1"), "invalid pid 0")
}

/*
Everything at once, which is the whole reason the store has a lock.

Kernels used to live in an exported map with nothing guarding it, written by the session handlers, the
kernel API and the shutdown path. Two of those at the same time is not a lost update but a dead
server: Go's answer to a concurrent map write is to kill the process. Only the store is exercised
here — no process is started or signalled.
*/
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
				setActiveKernel(id, KernelManager{KernelId: id, KernelName: "python3"})
				ActiveKernel(id)
				activeKernels()
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
	// Nothing to assert beyond having got here: the failure this is about takes the process with it.
	assert.NotNil(t, activeKernels())
}
