package terminal

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/zasper-io/zasper/internal/httpx"
	"github.com/zasper-io/zasper/internal/kernelspec"
)

// RunCommand is the line a terminal is given to run a file, and the interpreter in it.
type RunCommand struct {
	Command     string `json:"command"`
	Interpreter string `json:"interpreter"`
}

/*
runCommand is how a Python file is run: with the Python chosen in Settings, or else the project's own
.venv or venv, and otherwise whatever `python3` the user's shell finds, which is where an activated
conda or pyenv environment already is. The file goes by its absolute path, so a shell that has since been cd'd
elsewhere still runs the right one.

Quoted for a POSIX shell, which is the only kind a terminal here starts.
*/
func runCommand(root, file string) RunCommand {
	python := kernelspec.DefaultPython(root)
	if python == "" {
		return RunCommand{Command: "python3 " + shellQuote(file), Interpreter: "python3"}
	}
	return RunCommand{Command: shellQuote(python) + " " + shellQuote(file), Interpreter: python}
}

// shellQuote leaves a word that needs no quoting alone, so the line reads as someone would type it.
func shellQuote(word string) string {
	if word != "" && strings.IndexFunc(word, needsQuoting) == -1 {
		return word
	}
	return "'" + strings.ReplaceAll(word, "'", `'\''`) + "'"
}

func needsQuoting(r rune) bool {
	return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("/._-+:@%,", r))
}

// RunCommandHandler answers GET /api/terminals/run-command?path=, for a Python file in the project.
func (ts *Terminals) RunCommandHandler(w http.ResponseWriter, req *http.Request) {
	relativePath := req.URL.Query().Get("path")
	osPath := ts.project.SafePath(relativePath)
	if osPath == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "path is not inside the project")
		return
	}
	if strings.ToLower(filepath.Ext(osPath)) != ".py" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "only Python files can be run")
		return
	}
	if info, err := os.Stat(osPath); err != nil || info.IsDir() {
		httpx.SendErrorResponse(w, http.StatusNotFound, "no such file")
		return
	}
	httpx.SendJSON(w, http.StatusOK, runCommand(ts.project.Root(), osPath))
}
