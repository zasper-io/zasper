package kernelspec

import (
	"net/http"
	"sync"

	"github.com/zasper-io/zasper/internal/config"
	"github.com/zasper-io/zasper/internal/httpx"
)

// ProjectPython is the interpreter in the project's .venv or venv, or "" when it has neither. Found on
// disk, never run.
func ProjectPython(project string) string {
	return pythonIn(projectEnvironment(project))
}

/*
DefaultPython is the Python a file is run with: the one chosen in Settings, and otherwise the project's
own. "" means neither, and the caller falls back to whatever python3 the shell finds. A chosen Python
that has since been deleted is passed over rather than handed to a shell that cannot run it.
*/
func DefaultPython(project string) string {
	if chosen := config.GetPythonInterpreter(); chosen != "" && isExecutable(chosen) {
		return chosen
	}
	return ProjectPython(project)
}

// PythonInstall is a Python someone can choose, as Settings lists it.
type PythonInstall struct {
	Executable string `json:"executable"`
	Version    string `json:"version"`
	// Where it came from: "Homebrew", "pyenv", the name of a virtual environment's folder.
	Where string `json:"where"`
}

// InterpreterChoice is what Settings needs to offer the choice.
type InterpreterChoice struct {
	// Chosen is the saved choice, "" for automatic.
	Chosen string `json:"chosen"`
	// Automatic is what automatic means in this project: its own Python, or "" for the shell's python3.
	Automatic    string          `json:"automatic"`
	Interpreters []PythonInstall `json:"interpreters"`
}

/*
Interpreters is every Python the kernel list looks at, whether or not it has ipykernel: running a file
needs none. The project's own is read off disk as always; the rest are asked, once per binary.
*/
func (k *Catalog) Interpreters() []PythonInstall {
	candidates := k.candidates()
	found := make([]*interpreter, len(candidates))
	var wg sync.WaitGroup
	for i, c := range candidates {
		wg.Add(1)
		go func(i int, c candidate) {
			defer wg.Done()
			if c.env != "" {
				found[i] = inspectEnvironment(c.env)
			} else {
				found[i] = probe(c.path)
			}
		}(i, c)
	}
	wg.Wait()

	// One row per install: python3 and python3.12 in the same prefix are the same Python.
	seen := map[string]bool{}
	answer := []PythonInstall{}
	for _, python := range found {
		if python == nil {
			continue
		}
		prefix := canonicalPath(python.Prefix)
		if seen[prefix] {
			continue
		}
		seen[prefix] = true
		answer = append(answer, PythonInstall{
			Executable: python.Executable,
			Version:    python.Version,
			Where:      whereFrom(python.Prefix),
		})
	}
	return answer
}

// InterpretersHandler answers GET /api/interpreters.
func (k *Catalog) InterpretersHandler(w http.ResponseWriter, req *http.Request) {
	httpx.SendJSON(w, http.StatusOK, InterpreterChoice{
		Chosen:       config.GetPythonInterpreter(),
		Automatic:    ProjectPython(k.project),
		Interpreters: k.Interpreters(),
	})
}
