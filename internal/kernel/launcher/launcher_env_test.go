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

func TestTheKernelIsStartedWithTheEnvItWasGiven(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses sh")
	}
	out := filepath.Join(t.TempDir(), "env.txt")

	process, err := Launch(Spec{
		Argv: []string{"sh", "-c", `printf %s "$ZASPER_PROBE" > "$0"`, out},
		Env:  append(os.Environ(), "ZASPER_PROBE=from the spec"),
	})
	require.NoError(t, err)
	awaitDone(t, process)

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

	process, err := Launch(Spec{Argv: []string{"sh", "-c", `pwd -P > "$0"`, out}, Dir: dir})
	require.NoError(t, err)
	awaitDone(t, process)

	written, err := os.ReadFile(out)
	require.NoError(t, err)
	resolved, err := filepath.EvalSymlinks(dir)
	require.NoError(t, err)
	assert.Equal(t, resolved, strings.TrimSpace(string(written)))
}

func TestAKernelWithNoCommandIsRefused(t *testing.T) {
	process, err := Launch(Spec{})

	assert.Error(t, err)
	assert.Nil(t, process)
}

func TestAKernelThatCannotStartSaysSo(t *testing.T) {
	process, err := Launch(Spec{Argv: []string{"/nowhere/python3", "-m", "ipykernel_launcher"}})

	assert.Error(t, err)
	assert.Nil(t, process)
}
