/*
Stopping a kernel process.

The guard these are about is one line: a pid of 0 passed to os.FindProcess and then Kill is "every
process in this process group" on Unix, which is the server and every kernel under it. A kernel
manager that never launched has a zero pid, so the value reaches here by ordinary means rather than
by anything exotic.
*/
package launcher

import (
	"os/exec"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShutdownRefusesAPidThatWouldNotBeOneProcess(t *testing.T) {
	cases := map[string]int{
		"a manager that never launched": 0,
		"a whole process group":         -1,
		"a group by number":             -4242,
	}

	for name, pid := range cases {
		t.Run(name, func(t *testing.T) {
			err := ShutdownKernel(pid)
			require.Error(t, err, "pid %d was accepted", pid)
			assert.Contains(t, err.Error(), "invalid pid")
		})
	}
}

func TestShutdownStopsTheProcessItWasGiven(t *testing.T) {
	sleep, err := exec.LookPath("sleep")
	if err != nil {
		t.Skip("no sleep binary is installed")
	}

	cmd := exec.Command(sleep, "60")
	require.NoError(t, cmd.Start())
	pid := cmd.Process.Pid

	require.NoError(t, ShutdownKernel(pid))

	// Wait rather than poll: the process is this test's child, so nothing else can reap it, and
	// Wait is what turns it from a zombie into a real exit status.
	state, err := cmd.Process.Wait()
	require.NoError(t, err)
	assert.False(t, state.Success(), "the process exited normally rather than being killed")

	// Killed, and killed by the signal Kill sends — not stopped by something else in the meantime.
	status, ok := state.Sys().(syscall.WaitStatus)
	require.True(t, ok)
	assert.Equal(t, syscall.SIGKILL, status.Signal())

	// And it is gone: signal 0 asks whether the process is still there without sending anything.
	assert.Eventually(t, func() bool {
		return cmd.Process.Signal(syscall.Signal(0)) != nil
	}, 2*time.Second, 20*time.Millisecond, "the process is still running")
}
