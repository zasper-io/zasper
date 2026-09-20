package kernelspec

import (
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
