/*
Launching and signalling a kernel process.

Every signal goes through a pid check first: a pid of 0 or below names a whole process group on Unix,
which is the server and every kernel under it, and a manager that never launched has a pid of 0.
*/
package launcher

import (
	"runtime"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSignalsRefuseAPidThatWouldNotBeOneProcess(t *testing.T) {
	cases := map[string]int{
		"a manager that never launched": 0,
		"a whole process group":         -1,
		"a group by number":             -4242,
	}

	for name, pid := range cases {
		t.Run(name, func(t *testing.T) {
			process := &Process{Pid: pid}
			for _, signal := range []func() error{process.Interrupt, process.Terminate, process.Kill} {
				err := signal()
				require.Error(t, err, "pid %d was accepted", pid)
				assert.Contains(t, err.Error(), "invalid pid")
			}
		})
	}
}

func TestAKernelProcessIsReapedWhenItExits(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses sh")
	}

	process, err := LaunchKernel([]string{"sh", "-c", "exit 3"}, map[string]interface{}{}, "")
	require.NoError(t, err)

	awaitDone(t, process)
	assert.Equal(t, 3, process.ExitCode())
}

func awaitDone(t *testing.T, process *Process) {
	t.Helper()

	select {
	case <-process.Done():
	case <-time.After(10 * time.Second):
		t.Fatalf("process %d was never reaped", process.Pid)
	}
}
