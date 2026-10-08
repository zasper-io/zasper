package kernelspec

import (
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
)

// The listing's default is a kernel that is installed, not python3 regardless.
func TestTheDefaultKernelIsOneThatIsInstalled(t *testing.T) {
	t.Parallel()

	spec := func(language string) KspecData {
		return KspecData{Spec: KernelSpecJsonData{Language: language}}
	}

	assert.Equal(t, "python3", defaultKernelName(map[string]KspecData{"ir": spec("R"), "python3": spec("python")}))
	assert.Equal(t, "project-venv", defaultKernelName(map[string]KspecData{"ir": spec("R"), "project-venv": spec("Python")}))
	assert.Equal(t, "ir", defaultKernelName(map[string]KspecData{"julia-1.10": spec("julia"), "ir": spec("R")}))
	assert.Equal(t, "", defaultKernelName(map[string]KspecData{}))
}

// A kernel started for the Data panel runs the project's Python, even when a kernelspec rather than
// project-venv offers it, and never one whose interpreter has been deleted.
func TestThePythonKernelIsTheProjectsAndCanStart(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("environments are laid out differently on Windows")
	}
	aHome(t)
	catalog, kernels := jupyterPathHere(t)
	project := t.TempDir()
	catalog.project = project
	gone := `{"argv": ["/no/such/venv/bin/python3", "-m", "ipykernel_launcher"], "language": "python"}`
	kernelDir(t, kernels, "aa-deleted", gone)
	kernelDir(t, kernels, "bb-anywhere", pythonSpec)

	assert.Equal(t, "bb-anywhere", catalog.PythonKernelName())

	own := aVenv(t, filepath.Join(project, ".venv"), "3.12")
	kernelDir(t, kernels, "zz-project", `{"argv": ["`+own+`", "-m", "ipykernel_launcher"], "language": "python"}`)

	assert.Equal(t, "zz-project", catalog.PythonKernelName())
}
