package kernelspec

import "sync"

// Catalog is where a server finds its kernels: the kernelspecs on a Jupyter path, and the Pythons with
// ipykernel that have none. It also runs the setup of the project's own environment, one at a time.
type Catalog struct {
	jupyterPath []string
	project     string
	// Where Pythons are looked for, and the tools a setup uses; tests replace both.
	candidates func() []candidate
	setupTools func() (uv string, base string)

	setupMu     sync.Mutex
	setupStatus SetupStatus
}

// NewCatalog finds kernels on jupyterPath and in the environments of the project at project.
func NewCatalog(jupyterPath []string, project string) *Catalog {
	k := &Catalog{jupyterPath: jupyterPath, project: project, setupStatus: SetupStatus{State: "idle"}}
	k.candidates = func() []candidate { return defaultInterpreterCandidates(project) }
	k.setupTools = k.findSetupTools
	return k
}
