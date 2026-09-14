package kernel

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/kernelspec"
)

func TestASpecsEnvIsLaidOverTheServersWithItsReferencesFilled(t *testing.T) {
	base := []string{"PATH=/usr/bin", "HOME=/home/me", "KEEP=server"}

	env := kernelEnv(base, map[string]string{
		"PATH":    "/opt/R/bin:${PATH}",
		"R_HOME":  "$HOME/R",
		"MISSING": "${NOT_SET}/x",
		"DOLLAR":  "cost $$5",
	})

	// Last wins in os/exec, so what the kernel sees is the final value for each name.
	seen := map[string]string{}
	for _, entry := range env {
		name, value, _ := strings.Cut(entry, "=")
		seen[name] = value
	}
	assert.Equal(t, "/opt/R/bin:/usr/bin", seen["PATH"])
	assert.Equal(t, "/home/me/R", seen["R_HOME"])
	assert.Equal(t, "${NOT_SET}/x", seen["MISSING"], "an unknown name is left as written")
	assert.Equal(t, "cost $5", seen["DOLLAR"])
	assert.Equal(t, "server", seen["KEEP"])
	assert.Equal(t, base, env[:len(base)], "the server's environment is not rewritten in place")
}

func TestASpecWithNoEnvLeavesTheServersAlone(t *testing.T) {
	base := []string{"PATH=/usr/bin"}
	assert.Equal(t, base, kernelEnv(base, nil))
}

// A kernel name nobody installed used to reach formatKernelCmd with an empty argv and panic there,
// after the ports were taken and the connection file written.
func TestAnUnknownKernelFailsBeforeAnythingIsSetUp(t *testing.T) {
	previous := core.Zasper.JupyterPath
	core.Zasper.JupyterPath = []string{t.TempDir()}
	t.Cleanup(func() { core.Zasper.JupyterPath = previous })

	connectionFile := filepath.Join(t.TempDir(), "kernel-test.json")
	km := KernelManager{KernelName: "no-such-kernel", ConnectionFile: connectionFile}

	_, _, err := km.asyncPrestartKernel("no-such-kernel")

	require.ErrorIs(t, err, kernelspec.ErrKernelspecNotFound)
	_, statErr := os.Stat(connectionFile)
	assert.True(t, os.IsNotExist(statErr), "a connection file was written for a kernel that cannot start")
}

// ipykernel exits once the process JPY_PARENT_PID names has gone, which is what keeps a crashed server
// from leaving its kernels running.
func TestAKernelIsToldWhichProcessStartedIt(t *testing.T) {
	root := t.TempDir()
	previous := core.Zasper.JupyterPath
	core.Zasper.JupyterPath = []string{root}
	t.Cleanup(func() { core.Zasper.JupyterPath = previous })

	dir := filepath.Join(root, "kernels", "fake")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "kernel.json"),
		[]byte(`{"argv": ["sh", "-c", "true"], "display_name": "fake", "language": "sh"}`), 0o644))

	km := KernelManager{KernelName: "fake", ConnectionFile: filepath.Join(t.TempDir(), "kernel-test.json")}
	_, kw, err := km.asyncPrestartKernel("fake")
	require.NoError(t, err)
	t.Cleanup(func() {
		info := km.ConnectionInfo
		for _, port := range []int{info.ShellPort, info.IopubPort, info.StdinPort, info.HbPort, info.ControlPort} {
			releasePort(port)
		}
	})

	env := kw["env"].([]string)
	parent := "JPY_PARENT_PID=" + strconv.Itoa(os.Getpid())
	if runtime.GOOS == "windows" {
		assert.NotContains(t, env, parent)
	} else {
		assert.Contains(t, env, parent)
	}
}
