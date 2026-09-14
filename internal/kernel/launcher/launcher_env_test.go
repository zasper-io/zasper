package launcher

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The env built from the kernelspec used to be handed over in kw and never read.
func TestTheKernelIsStartedWithTheEnvItWasGiven(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses sh")
	}
	out := filepath.Join(t.TempDir(), "env.txt")
	kw := map[string]interface{}{
		"env": append(os.Environ(), "ZASPER_PROBE=from the spec"),
	}

	process, err := LaunchKernel([]string{"sh", "-c", `printf %s "$ZASPER_PROBE" > "$0"`, out}, kw, "")
	require.NoError(t, err)
	_, err = process.Wait()
	require.NoError(t, err)

	written, err := os.ReadFile(out)
	require.NoError(t, err)
	assert.Equal(t, "from the spec", string(written))
}

func TestTheKernelIsStartedInTheDirectoryItWasGiven(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses sh")
	}
	dir := t.TempDir()
	out := filepath.Join(t.TempDir(), "cwd.txt")

	process, err := LaunchKernel([]string{"sh", "-c", `pwd -P > "$0"`, out}, map[string]interface{}{"cwd": dir}, "")
	require.NoError(t, err)
	_, err = process.Wait()
	require.NoError(t, err)

	written, err := os.ReadFile(out)
	require.NoError(t, err)
	resolved, err := filepath.EvalSymlinks(dir)
	require.NoError(t, err)
	assert.Equal(t, resolved, strings.TrimSpace(string(written)))
}
