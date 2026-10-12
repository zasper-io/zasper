package kernel

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOnlyTheConnectionFilesOfKernelsGoneAreSwept(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string, age time.Duration) string {
		path := filepath.Join(dir, name)
		require.NoError(t, os.WriteFile(path, []byte(body), 0o600))
		when := time.Now().Add(-age)
		require.NoError(t, os.Chtimes(path, when, when))
		return path
	}
	gone := write("kernel-gone.json", `{"ip": "127.0.0.1", "shell_port": 1111}`, time.Hour)
	running := write("kernel-running.json", `{"ip": "127.0.0.1", "shell_port": 2222}`, time.Hour)
	starting := write("kernel-starting.json", `{"ip": "127.0.0.1", "shell_port": 3333}`, time.Second)
	broken := write("kernel-broken.json", `not json`, time.Hour)
	other := write("server-1.json", `{}`, time.Hour)

	sweepConnectionFiles(dir, time.Now(), func(_ string, port int) bool { return port == 2222 })

	assert.NoFileExists(t, gone)
	assert.NoFileExists(t, broken)
	assert.FileExists(t, running)
	assert.FileExists(t, starting, "a kernel still starting has not bound its ports yet")
	assert.FileExists(t, other)
}
