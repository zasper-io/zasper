package kernelspec

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// executable writes a file that passes for an interpreter.
func executable(t *testing.T, path string) string {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755))
	return path
}

// specUnder answers a kernelspec directory in <prefix>/share/jupyter/kernels.
func specUnder(t *testing.T, prefix, name string) string {
	t.Helper()
	return kernelDir(t, filepath.Join(prefix, "share", "jupyter", "kernels"), name, pythonSpec)
}

func TestASpecInsideAPythonInstallRunsWithThatPython(t *testing.T) {
	t.Parallel()

	if runtime.GOOS == "windows" {
		t.Skip("unix layout")
	}
	prefix := t.TempDir()
	python := executable(t, filepath.Join(prefix, "bin", "python3"))
	require.NoError(t, os.MkdirAll(filepath.Join(prefix, "lib", "python3.12"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(prefix, "lib", "python3.12", "os.py"), nil, 0o644))

	assert.Equal(t, python, Interpreter(specUnder(t, prefix, "python3")))
}

func TestASpecInsideAVenvRunsWithTheVenvsPython(t *testing.T) {
	t.Parallel()

	if runtime.GOOS == "windows" {
		t.Skip("unix layout")
	}
	prefix := t.TempDir()
	python := executable(t, filepath.Join(prefix, "bin", "python3"))
	require.NoError(t, os.WriteFile(filepath.Join(prefix, "pyvenv.cfg"), []byte("home = /usr/bin\n"), 0o644))

	assert.Equal(t, python, Interpreter(specUnder(t, prefix, "python3")))
}

// ~/.local has site-packages and may have a bin/python3 (uv puts one there), but that Python did not
// install the kernels in ~/.local/share/jupyter, so it is not offered as their owner.
func TestADirectoryWithSitePackagesIsNotTakenForAPythonInstall(t *testing.T) {
	t.Parallel()

	if runtime.GOOS == "windows" {
		t.Skip("unix layout")
	}
	local := t.TempDir()
	executable(t, filepath.Join(local, "bin", "python3"))
	require.NoError(t, os.MkdirAll(filepath.Join(local, "lib", "python3.12", "site-packages"), 0o755))

	assert.Empty(t, Interpreter(specUnder(t, local, "python3")))
}

/*
The system Python's kernels on macOS: pip's user scheme puts them in ~/Library/Python/3.9, with argv
naming a bare `python`. They are that Python's, so they run with a python3.9, not with whatever
`python3` Homebrew put first on PATH.
*/
func TestAMacUserBaseSpecRunsWithThePythonOfItsVersion(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix layout")
	}
	home := t.TempDir()
	bin := t.TempDir()
	python39 := executable(t, filepath.Join(bin, "python3.9"))
	executable(t, filepath.Join(bin, "python3"))
	t.Setenv("PATH", bin)

	spec := specUnder(t, filepath.Join(home, "Library", "Python", "3.9"), "python3")

	assert.Equal(t, python39, Interpreter(spec))
}

func TestASpecOutsideAnyPythonsDirectoriesHasNoOwner(t *testing.T) {
	_, kernels := jupyterPath(t)
	assert.Empty(t, Interpreter(kernelDir(t, kernels, "python3", pythonSpec)))
	assert.Empty(t, Interpreter(""))
}

// The default `python3` kernelspec names `python`, which only a PATH resolves. The browser has none, and
// the language server it hands a notebook to has to be told the interpreter the kernel actually runs.
func TestTheApiReportsTheInterpreterASpecWouldBeLaunchedWith(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PATH resolution differs on Windows")
	}

	bin := t.TempDir()
	python := executable(t, filepath.Join(bin, "python"))
	t.Setenv("PATH", bin)

	model := kernelspecModel("python3", KernelSpecJsonData{
		Argv:        []string{"python", "-m", "ipykernel_launcher", "-f", "{connection_file}"},
		DisplayName: "Python 3",
		Language:    "python",
	})

	assert.Equal(t, python, model.Interpreter)
	// argv is what it was: the spec is reported as it is on disk.
	assert.Equal(t, "python", model.Spec.Argv[0])
}

func TestASpecNamingNoRunnableProgramReportsNoInterpreter(t *testing.T) {
	t.Setenv("PATH", t.TempDir())

	model := kernelspecModel("gone", KernelSpecJsonData{Argv: []string{"python-that-is-not-here"}})

	assert.Empty(t, model.Interpreter)
}

// The spec that comes with a `pip install --user ipykernel` names a bare `python` and sits in the user
// base of the Python that installed it. The launcher runs that Python; so must the interpreter the API
// reports, or the language server reads a different one and calls every import in the notebook missing.
func TestASpecUnderAPythonsOwnPrefixReportsThatPythonRatherThanThePath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("prefix layout differs on Windows")
	}

	prefix := t.TempDir()
	python := executable(t, filepath.Join(prefix, "bin", "python3"))
	// What makes the directory a Python install rather than any directory with a bin/python3 in it.
	require.NoError(t, os.MkdirAll(filepath.Join(prefix, "lib", "python3.12"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(prefix, "lib", "python3.12", "os.py"), nil, 0o644))
	resources := filepath.Join(prefix, "share", "jupyter", "kernels", "python3")
	require.NoError(t, os.MkdirAll(resources, 0o755))
	// Nothing runnable on the PATH, so only the spec's own location can answer.
	t.Setenv("PATH", t.TempDir())

	model := kernelspecModel("python3", KernelSpecJsonData{
		Argv:        []string{"python", "-m", "ipykernel_launcher", "-f", "{connection_file}"},
		Language:    "python",
		ResourceDir: resources,
	})

	assert.Equal(t, python, model.Interpreter)
}
