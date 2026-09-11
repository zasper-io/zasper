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
	kernels := jupyterPath(t)
	assert.Empty(t, Interpreter(kernelDir(t, kernels, "python3", pythonSpec)))
	assert.Empty(t, Interpreter(""))
}
