package kernel

import (
	"os"
	"path/filepath"
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
	km := KernelManager{KernelName: "no-such-kernel", ConnectionFile: connectionFile, CachePorts: true}

	_, _, err := km.asyncPrestartKernel("no-such-kernel")

	require.ErrorIs(t, err, kernelspec.ErrKernelspecNotFound)
	_, statErr := os.Stat(connectionFile)
	assert.True(t, os.IsNotExist(statErr), "a connection file was written for a kernel that cannot start")
}
