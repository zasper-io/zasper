//go:build windows

package launcher

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/windows"
)

// The test binary run as a stand-in kernel, chosen by LAUNCHER_HELPER: it is not a test of its own.
func TestLauncherHelper(t *testing.T) {
	switch os.Getenv("LAUNCHER_HELPER") {
	case "wait-for-interrupt":
		// As ipykernel's ParentPollerWindows does: the handle's number is in the environment.
		handle, err := strconv.ParseUint(os.Getenv("JPY_INTERRUPT_EVENT"), 10, 64)
		if err != nil {
			os.Exit(2)
		}
		if event, _ := windows.WaitForSingleObject(windows.Handle(handle), 30000); event == windows.WAIT_OBJECT_0 {
			os.Exit(7)
		}
		os.Exit(3)
	case "start-a-child":
		child := exec.Command(os.Args[0], "-test.run=^TestLauncherHelper$")
		child.Env = append(os.Environ(), "LAUNCHER_HELPER=sleep")
		if child.Start() != nil {
			os.Exit(2)
		}
		os.WriteFile(os.Getenv("LAUNCHER_PID_FILE"), []byte(strconv.Itoa(child.Process.Pid)), 0o644)
		time.Sleep(time.Minute)
		os.Exit(0)
	case "sleep":
		time.Sleep(time.Minute)
		os.Exit(0)
	}
}

func helper(t *testing.T, role string, env ...string) *Process {
	t.Helper()
	process, err := Launch(Spec{
		Argv: []string{os.Args[0], "-test.run=^TestLauncherHelper$"},
		Env:  append(append(os.Environ(), "LAUNCHER_HELPER="+role), env...),
	})
	require.NoError(t, err)
	t.Cleanup(func() { process.Kill() })
	return process
}

func TestAnInterruptSetsTheEventTheKernelWaitsOn(t *testing.T) {
	process := helper(t, "wait-for-interrupt")
	time.Sleep(500 * time.Millisecond)

	require.NoError(t, process.Interrupt())

	select {
	case <-process.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("the kernel never saw the interrupt")
	}
	assert.Equal(t, 7, process.ExitCode())
}

func TestKillEndsWhatTheKernelStartedToo(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "child")
	process := helper(t, "start-a-child", "LAUNCHER_PID_FILE="+pidFile)

	var child int
	require.Eventually(t, func() bool {
		data, err := os.ReadFile(pidFile)
		child, _ = strconv.Atoi(strings.TrimSpace(string(data)))
		return err == nil && child > 0
	}, 10*time.Second, 50*time.Millisecond)
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(child))
	require.NoError(t, err)
	defer windows.CloseHandle(handle)

	require.NoError(t, process.Kill())

	event, err := windows.WaitForSingleObject(handle, 10000)
	require.NoError(t, err)
	assert.Equal(t, uint32(windows.WAIT_OBJECT_0), event, "the kernel's child outlived it")
}
