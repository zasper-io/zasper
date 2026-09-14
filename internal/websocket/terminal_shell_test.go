package websocket

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// installedShell makes an executable called name, standing in for a shell that is installed.
func installedShell(t *testing.T, name string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("terminals are not available on Windows")
	}

	path := filepath.Join(t.TempDir(), name)
	require.NoError(t, os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755))
	return path
}

func environment(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestATerminalRunsTheShellInSHELL(t *testing.T) {
	fish := installedShell(t, "fish")
	askedForLoginShell := false

	shell := shellFor(environment(map[string]string{"SHELL": fish}), func() string {
		askedForLoginShell = true
		return ""
	})

	assert.Equal(t, fish, shell)
	assert.False(t, askedForLoginShell, "the account database was read although $SHELL would do")
}

func TestWithoutSHELLATerminalRunsTheLoginShell(t *testing.T) {
	bash := installedShell(t, "bash")

	shell := shellFor(environment(nil), func() string { return bash })

	assert.Equal(t, bash, shell)
}

// Alpine, minimal containers and FreeBSD's default install have no bash, which was the only shell
// tried outside macOS.
func TestAShellThatIsNotInstalledIsPassedOverForBinSh(t *testing.T) {
	installedShell(t, "unused")

	shell := shellFor(environment(map[string]string{"SHELL": "/nowhere/fish"}), func() string { return "/nowhere/zsh" })

	assert.Equal(t, "/bin/sh", shell)
}

func TestTheLoginShellIsReadFromPasswd(t *testing.T) {
	passwd := "root:x:0:0:root:/root:/bin/bash\n" +
		"# a comment\n" +
		"ada:x:1001:1001:Ada:/home/ada:/usr/bin/fish\n"

	assert.Equal(t, "/usr/bin/fish", passwdShell(strings.NewReader(passwd), "1001"))
	assert.Equal(t, "", passwdShell(strings.NewReader(passwd), "1002"))
}

func TestTheLoginShellIsReadFromDirectoryServices(t *testing.T) {
	assert.Equal(t, "/bin/zsh", dsclShell("UserShell: /bin/zsh\n"))
	assert.Equal(t, "", dsclShell("No such key: UserShell\n"))
}

// Their connections are hijacked, so the server's own shutdown neither waits for nor closes them.
func TestStoppingTerminalsKillsEveryShell(t *testing.T) {
	requireShell(t)

	tty, cmd, err := startTTY(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { tty.Close() })
	registerTerminalSession("stop-every-shell", &TerminalSession{TTY: tty, Cmd: cmd})
	t.Cleanup(func() { unregisterTerminalSession("stop-every-shell") })

	StopTerminals()

	assert.True(t, errors.Is(cmd.Process.Signal(syscall.Signal(0)), os.ErrProcessDone), "the shell is still running")
}
