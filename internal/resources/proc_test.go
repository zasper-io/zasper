//go:build linux || darwin

package resources

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestThisProcessIsInTheTable(t *testing.T) {
	processes, err := readProcesses()
	require.NoError(t, err)

	var self *Process
	for i := range processes {
		if processes[i].Pid == os.Getpid() {
			self = &processes[i]
		}
	}
	require.NotNil(t, self)
	assert.Equal(t, os.Getppid(), self.Ppid)
	assert.Greater(t, self.RSS, uint64(1024*1024), "a Go test binary holds more than a megabyte")
}

func TestTheMachinesMemoryIsRead(t *testing.T) {
	machine, err := readMachine()
	require.NoError(t, err)
	assert.Positive(t, machine.Total)
	assert.LessOrEqual(t, machine.Used, machine.Total)
}

func TestThisProcessHasAFootprint(t *testing.T) {
	processes, err := readProcesses()
	require.NoError(t, err)
	for _, p := range processes {
		if p.Pid == os.Getpid() {
			assert.Greater(t, footprint(p), uint64(1024*1024))
			return
		}
	}
	t.Fatal("this process is not in the table")
}
