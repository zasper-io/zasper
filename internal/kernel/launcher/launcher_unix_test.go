//go:build unix

package launcher

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Signal 0 still reaches a zombie, so it failing is what says the process was reaped and not only exited.
func TestAnExitedKernelIsNotLeftAsAZombie(t *testing.T) {
	process, err := LaunchKernel([]string{"sh", "-c", "exit 0"}, map[string]interface{}{}, "")
	require.NoError(t, err)

	awaitDone(t, process)
	assert.ErrorIs(t, syscall.Kill(process.Pid, 0), syscall.ESRCH)
}

func TestKillEndsWhatTheKernelStartedToo(t *testing.T) {
	out := filepath.Join(t.TempDir(), "child.pid")
	process, err := LaunchKernel(
		[]string{"sh", "-c", `sleep 60 & echo $! > "$0"; wait`, out}, map[string]interface{}{}, "")
	require.NoError(t, err)

	var child int
	require.Eventually(t, func() bool {
		written, err := os.ReadFile(out)
		if err != nil {
			return false
		}
		child, err = strconv.Atoi(strings.TrimSpace(string(written)))
		return err == nil
	}, 5*time.Second, 20*time.Millisecond, "the kernel never started its child")

	require.NoError(t, process.Kill())

	awaitDone(t, process)
	assert.Equal(t, -1, process.ExitCode(), "the kernel exited rather than being killed")
	assert.Eventually(t, func() bool {
		return errors.Is(syscall.Kill(child, 0), syscall.ESRCH)
	}, 5*time.Second, 50*time.Millisecond, "the kernel's child is still running")
}
