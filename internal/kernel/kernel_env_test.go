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

// A kernel name nobody installed must fail before any port is taken or connection file written.
func TestAnUnknownKernelFailsBeforeAnythingIsSetUp(t *testing.T) {
	previous := core.Zasper.JupyterPath
	core.Zasper.JupyterPath = []string{t.TempDir()}
	t.Cleanup(func() { core.Zasper.JupyterPath = previous })

	connectionFile := filepath.Join(t.TempDir(), "kernel-test.json")
	km := &KernelManager{KernelName: "no-such-kernel", ConnectionFile: connectionFile}

	err := km.start()

	require.ErrorIs(t, err, kernelspec.ErrKernelspecNotFound)
	_, statErr := os.Stat(connectionFile)
	assert.True(t, os.IsNotExist(statErr), "a connection file was written for a kernel that cannot start")
	assert.Nil(t, km.Process)
}

// A launch that fails gives back what it took: the ports and the connection file with its signing key.
func TestAKernelThatCannotLaunchLeavesNothingBehind(t *testing.T) {
	root := t.TempDir()
	previous := core.Zasper.JupyterPath
	core.Zasper.JupyterPath = []string{root}
	t.Cleanup(func() { core.Zasper.JupyterPath = previous })

	dir := filepath.Join(root, "kernels", "broken")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "kernel.json"),
		[]byte(`{"argv": ["/nowhere/kernel", "{connection_file}"], "display_name": "broken", "language": "sh"}`), 0o644))

	connectionFile := filepath.Join(t.TempDir(), "kernel-test.json")
	km := &KernelManager{KernelName: "broken", ConnectionFile: connectionFile}

	require.Error(t, km.start())

	_, statErr := os.Stat(connectionFile)
	assert.True(t, os.IsNotExist(statErr), "the connection file was left behind")
	for _, port := range km.ports() {
		assert.False(t, portExists(*port), "port %d is still taken", *port)
	}
}

// ipykernel exits once the process JPY_PARENT_PID names has gone, which is what keeps a crashed server
// from leaving its kernels running.
func TestAKernelIsToldWhichProcessStartedIt(t *testing.T) {
	env := (&KernelManager{}).launchSpec().Env

	parent := "JPY_PARENT_PID=" + strconv.Itoa(os.Getpid())
	if runtime.GOOS == "windows" {
		assert.NotContains(t, env, parent)
	} else {
		assert.Contains(t, env, parent)
	}
}

func TestAKernelStartsInItsFolderWithItsOwnVariablesLast(t *testing.T) {
	km := &KernelManager{
		Dir: "/work/notebooks",
		Env: map[string]string{"JPY_SESSION_NAME": "/work/notebooks/a$b.ipynb"},
	}

	spec := km.launchSpec()

	assert.Equal(t, "/work/notebooks", spec.Dir)
	assert.Equal(t, "JPY_SESSION_NAME=/work/notebooks/a$b.ipynb", spec.Env[len(spec.Env)-1],
		"a notebook's own variable is added as written, after the kernelspec's")
}

func TestTheConnectionFileIsFilledIntoTheCommand(t *testing.T) {
	km := &KernelManager{
		ConnectionFile: "/run/kernel-1.json",
		Spec:           kernelspec.KernelSpecJsonData{Argv: []string{"ir", "--connection-file", "{connection_file}"}},
	}

	assert.Equal(t, []string{"ir", "--connection-file", "/run/kernel-1.json"}, km.argv())
	assert.Equal(t, "{connection_file}", km.Spec.Argv[2], "the kernelspec itself is not rewritten")
}
