//go:build unix

package kernel

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// shortHome is a home whose runtime folder is shallow enough for a socket's address, which t.TempDir
// under macOS's /var/folders is not always.
func shortHome(t *testing.T) string {
	home, err := os.MkdirTemp("", "zh")
	require.NoError(t, err)
	t.Cleanup(func() { os.RemoveAll(home) })
	t.Setenv("HOME", home)
	return home
}

const kernelId = "0f8fad5b-d9cb-469f-a165-70867728950e"

func TestAnIpykernelIsGivenSocketsInTheRuntimeFolder(t *testing.T) {
	home := shortHome(t)

	address := ipcAddress([]string{"/env/bin/python", "-m", "ipykernel_launcher", "-f", "{connection_file}"}, kernelId)

	assert.Equal(t, filepath.Join(home, ".zasper", "runtime", "kernel-0f8fad5bd9cb"), address)
}

func TestOtherKernelsAndDeepFoldersKeepTCP(t *testing.T) {
	shortHome(t)
	assert.Empty(t, ipcAddress([]string{"/opt/homebrew/bin/deno", "jupyter", "--kernel", "--conn", "{connection_file}"}, kernelId))
	assert.Empty(t, ipcAddress([]string{"R", "--slave", "-e", "IRkernel::main()", "--args", "{connection_file}"}, kernelId))

	deep := filepath.Join(shortHome(t), strings.Repeat("d", maxSocketPath()))
	require.NoError(t, os.MkdirAll(deep, 0o700))
	t.Setenv("HOME", deep)
	assert.Empty(t, ipcAddress([]string{"python", "-m", "ipykernel_launcher", "-f", "{connection_file}"}, kernelId))
}

func TestTheSweepAsksAnIPCKernelThroughItsSocket(t *testing.T) {
	dir := filepath.Join(shortHome(t), "rt")
	require.NoError(t, os.Mkdir(dir, 0o700))
	write := func(name, address string) string {
		path := filepath.Join(dir, name)
		body := `{"transport": "ipc", "ip": "` + address + `", "shell_port": 1, "iopub_port": 2, "stdin_port": 3, "hb_port": 4, "control_port": 5}`
		require.NoError(t, os.WriteFile(path, []byte(body), 0o600))
		old := time.Now().Add(-time.Hour)
		require.NoError(t, os.Chtimes(path, old, old))
		return path
	}

	running := write("kernel-running.json", filepath.Join(dir, "kernel-aaaa"))
	listener, err := net.Listen("unix", filepath.Join(dir, "kernel-aaaa-1"))
	require.NoError(t, err)
	defer listener.Close()

	gone := write("kernel-gone.json", filepath.Join(dir, "kernel-bbbb"))
	var leftovers []string
	for _, port := range []string{"1", "2", "3", "4", "5"} {
		leftover := filepath.Join(dir, "kernel-bbbb-"+port)
		require.NoError(t, os.WriteFile(leftover, nil, 0o600))
		leftovers = append(leftovers, leftover)
	}

	sweepConnectionFiles(dir, time.Now(), listening)

	assert.FileExists(t, running)
	assert.FileExists(t, filepath.Join(dir, "kernel-aaaa-1"))
	assert.NoFileExists(t, gone)
	for _, leftover := range leftovers {
		assert.NoFileExists(t, leftover, "a kernel that was killed leaves its sockets")
	}
}
