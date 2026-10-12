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
	process, err := Launch(Spec{Argv: []string{"sh", "-c", "exit 0"}})
	require.NoError(t, err)

	awaitDone(t, process)
	assert.ErrorIs(t, syscall.Kill(process.Pid, 0), syscall.ESRCH)
}

func TestKillEndsWhatTheKernelStartedToo(t *testing.T) {
	out := filepath.Join(t.TempDir(), "child.pid")
	process, err := Launch(Spec{Argv: []string{"sh", "-c", `sleep 60 & echo $! > "$0"; wait`, out}})
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

func TestTheTreeOfAProcessIsEverythingItStarted(t *testing.T) {
	process, err := Launch(Spec{Argv: []string{"sh", "-c", "sleep 30 & sleep 30 & wait"}})
	require.NoError(t, err)
	t.Cleanup(func() { process.Kill() })

	var tree []int
	require.Eventually(t, func() bool {
		tree = process.Tree()
		return len(tree) == 2
	}, 5*time.Second, 50*time.Millisecond)

	process.Kill()
	SignalTree(tree, true)
	require.Eventually(t, func() bool {
		for _, pid := range tree {
			if syscall.Kill(pid, 0) == nil {
				return false
			}
		}
		return true
	}, 5*time.Second, 50*time.Millisecond, "a child outlived its tree")
}
