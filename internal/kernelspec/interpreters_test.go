package kernelspec

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/core"
)

// noInterpreters leaves out every Python on this machine, so what is listed is what a test wrote.
func noInterpreters(t *testing.T) {
	stubCandidates(t)
}

func stubCandidates(t *testing.T, candidates ...candidate) {
	t.Helper()
	previous := interpreterCandidates
	interpreterCandidates = func() []candidate { return candidates }
	t.Cleanup(func() { interpreterCandidates = previous })
}

func unixOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses sh scripts as interpreters")
	}
}

// fakePython writes an interpreter at prefix that answers the probe as a Python 3.12 would, and
// answers it with its site-packages.
func fakePython(t *testing.T, prefix string) (python, sitePackages string) {
	t.Helper()
	sitePackages = filepath.Join(prefix, "lib", "python3.12", "site-packages")
	require.NoError(t, os.MkdirAll(sitePackages, 0o755))
	python = filepath.Join(prefix, "bin", "python3")
	answer := fmt.Sprintf(`{"executable": "%s", "version": "3.12", "prefix": "%s", "paths": ["%s"]}`, python, prefix, sitePackages)
	executable(t, python)
	require.NoError(t, os.WriteFile(python, []byte("#!/bin/sh\nprintf '%s\\n' '"+answer+"'\n"), 0o755))
	return python, sitePackages
}

func installIpykernel(t *testing.T, sitePackages string) {
	t.Helper()
	resources := filepath.Join(sitePackages, "ipykernel", "resources")
	require.NoError(t, os.MkdirAll(resources, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(sitePackages, "ipykernel", "__init__.py"), nil, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(resources, "logo-64x64.png"), []byte("png"), 0o644))
}

func TestAPythonWithIpykernelAndNoSpecIsOfferedWithoutWritingOne(t *testing.T) {
	unixOnly(t)
	kernels := jupyterPath(t)
	python, sitePackages := fakePython(t, t.TempDir())
	installIpykernel(t, sitePackages)
	stubCandidates(t, candidate{path: python})

	spec, err := GetKernelSpec("python3")

	require.NoError(t, err)
	assert.Equal(t, []string{python, "-m", "ipykernel_launcher", "-f", "{connection_file}"}, spec.Argv)
	assert.Contains(t, spec.DisplayName, "Python 3.12")
	logo, ok := getResourceFile("python3", "logo-64x64.png")
	assert.True(t, ok)
	assert.FileExists(t, logo)

	written, err := os.ReadDir(kernels)
	require.NoError(t, err)
	assert.Empty(t, written, "a kernelspec was written to disk")
}

// Asked once; whether ipykernel is there is looked at every time.
func TestIpykernelInstalledLaterIsSeenWithoutRestarting(t *testing.T) {
	unixOnly(t)
	jupyterPath(t)
	python, sitePackages := fakePython(t, t.TempDir())
	stubCandidates(t, candidate{path: python})

	assert.Empty(t, GetAllSpecs())

	installIpykernel(t, sitePackages)
	assert.Contains(t, GetAllSpecs(), "python3")
}

func TestAPythonThatASpecAlreadyRunsIsNotOfferedTwice(t *testing.T) {
	unixOnly(t)
	kernels := jupyterPath(t)
	python, sitePackages := fakePython(t, t.TempDir())
	installIpykernel(t, sitePackages)
	stubCandidates(t, candidate{path: python})
	kernelDir(t, kernels, "mine", `{"argv": ["`+python+`", "-m", "ipykernel_launcher", "-f", "{connection_file}"], "display_name": "Mine", "language": "python"}`)

	specs := GetAllSpecs()

	assert.Len(t, specs, 1)
	assert.Contains(t, specs, "mine")
}

// python3 is the installed spec's; this one is named for its version and kind, and runs activated.
func TestWithPython3TakenAVenvIsNamedForItsVersionAndRunsActivated(t *testing.T) {
	unixOnly(t)
	kernels := jupyterPath(t)
	kernelDir(t, kernels, "python3", `{"argv": ["/elsewhere/bin/python3"], "display_name": "Python 3", "language": "python"}`)
	prefix := t.TempDir()
	python, sitePackages := fakePython(t, prefix)
	require.NoError(t, os.WriteFile(filepath.Join(prefix, "pyvenv.cfg"), []byte("version = 3.12.4\n"), 0o644))
	installIpykernel(t, sitePackages)
	stubCandidates(t, candidate{path: python})

	spec, err := GetKernelSpec("python3.12-venv")

	require.NoError(t, err)
	assert.Equal(t, prefix, spec.Env["VIRTUAL_ENV"])
	assert.Equal(t, filepath.Join(prefix, "bin")+string(os.PathListSeparator)+"${PATH}", spec.Env["PATH"])
}

/*
The project's .venv, offered as project-venv and found without being run: its python here writes a
file when it is executed, and the file must not appear.
*/
func TestTheProjectsVenvIsOfferedFirstAndNeverRunToFindIt(t *testing.T) {
	unixOnly(t)
	jupyterPath(t)
	project := t.TempDir()
	venv := filepath.Join(project, ".venv")
	ran := filepath.Join(t.TempDir(), "ran")
	python := executable(t, filepath.Join(venv, "bin", "python3"))
	require.NoError(t, os.WriteFile(python, []byte("#!/bin/sh\ntouch '"+ran+"'\n"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(venv, "pyvenv.cfg"), []byte("version_info = 3.12.4\n"), 0o644))
	sitePackages := filepath.Join(venv, "lib", "python3.12", "site-packages")
	installIpykernel(t, sitePackages)

	previous := core.Zasper.HomeDir
	core.Zasper.HomeDir = project
	t.Cleanup(func() { core.Zasper.HomeDir = previous })
	first := defaultInterpreterCandidates()[0]
	assert.Equal(t, candidate{path: python, env: venv}, first)
	stubCandidates(t, first)

	spec, err := GetKernelSpec(ProjectKernelName)

	require.NoError(t, err)
	assert.Equal(t, python, spec.Argv[0])
	assert.Equal(t, "Python 3.12 (.venv)", spec.DisplayName)
	assert.Equal(t, venv, spec.Env["VIRTUAL_ENV"])
	assert.NoFileExists(t, ran, "the project's python was run to list it")
}

func TestTheInstallerShimsAreNeverRun(t *testing.T) {
	found := usableCandidates([]candidate{
		{path: "/usr/bin/python3"},
		{path: "/opt/homebrew/bin/python3"},
		{path: "/opt/homebrew/bin/python3"},
		{path: ""},
	}, "darwin")
	assert.Equal(t, []candidate{{path: "/opt/homebrew/bin/python3"}}, found)

	assert.True(t, isShim(`C:\Users\me\AppData\Local\Microsoft\WindowsApps\python.exe`, "windows"))
	assert.False(t, isShim("/usr/bin/python3", "linux"))
}
