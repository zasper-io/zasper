/*
Which Python runs a file, and which ones Settings offers in its place. Not parallel: the choice is read
from the config file under HOME.
*/
package kernelspec

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zasper-io/zasper/internal/config"
)

func aHome(t *testing.T) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
}

// aVenv makes an environment that is read off disk and never run.
func aVenv(t *testing.T, dir, version string) string {
	t.Helper()
	python := filepath.Join(dir, "bin", "python3")
	require.NoError(t, os.MkdirAll(filepath.Dir(python), 0o755))
	require.NoError(t, os.WriteFile(python, nil, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "pyvenv.cfg"), []byte("version = "+version+".1\n"), 0o644))
	return python
}

func TestTheChosenPythonWinsOverTheProjectsOwn(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("environments are laid out differently on Windows")
	}
	aHome(t)
	project := t.TempDir()
	own := aVenv(t, filepath.Join(project, ".venv"), "3.12")
	assert.Equal(t, own, DefaultPython(project), "automatic is the project's own")

	chosen := aVenv(t, filepath.Join(t.TempDir(), "elsewhere"), "3.11")
	require.NoError(t, config.WriteConfig(&config.Config{PythonInterpreter: chosen}))
	assert.Equal(t, chosen, DefaultPython(project))

	// Deleted since it was chosen: passed over rather than handed to a shell that cannot run it.
	require.NoError(t, os.Remove(chosen))
	assert.Equal(t, own, DefaultPython(project))
}

func TestWithNothingChosenAndNoVenvTheShellDecides(t *testing.T) {
	aHome(t)
	assert.Equal(t, "", DefaultPython(t.TempDir()))
}

func TestEveryInstallIsListedOnce(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("environments are laid out differently on Windows")
	}
	first := filepath.Join(t.TempDir(), "analysis")
	second := filepath.Join(t.TempDir(), "web")
	aVenv(t, first, "3.12")
	aVenv(t, second, "3.11")

	catalog := NewCatalog(nil, t.TempDir())
	catalog.candidates = func() []candidate {
		// The same environment twice, as python3 and python name one install.
		return []candidate{{path: pythonIn(first), env: first}, {path: pythonIn(first), env: first}, {path: pythonIn(second), env: second}}
	}

	assert.Equal(t, []PythonInstall{
		{Executable: pythonIn(first), Version: "3.12", Where: "analysis"},
		{Executable: pythonIn(second), Version: "3.11", Where: "web"},
	}, catalog.Interpreters())
}
