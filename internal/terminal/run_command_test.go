/*
The line "Run Python File" types into a terminal: which Python it names, and that a path with a space
or a quote in it still reaches the shell as one word.

Not parallel: which Python is chosen is read from the config file under HOME.
*/
package terminal

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/config"
	"github.com/zasper-io/zasper/internal/content"
)

// runTerminals is testTerminals with a HOME of its own, which t.Setenv forbids alongside t.Parallel.
func runTerminals(t *testing.T) (*Terminals, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	dir := t.TempDir()
	return New(content.NewProject(dir)), dir
}

func askRunCommand(t *testing.T, terminals *Terminals, path string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	terminals.RunCommandHandler(recorder, httptest.NewRequest("GET", "/api/terminals/run-command?path="+path, nil))
	return recorder
}

func writeFile(t *testing.T, path string, mode os.FileMode) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, []byte(""), mode))
}

func TestAFileIsRunWithTheProjectsOwnVenv(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("terminals do not start on Windows")
	}
	terminals, dir := runTerminals(t)
	python := filepath.Join(dir, ".venv", "bin", "python3")
	writeFile(t, python, 0o755)
	writeFile(t, filepath.Join(dir, "src", "train.py"), 0o644)

	recorder := askRunCommand(t, terminals, "src/train.py")
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())

	var answer RunCommand
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &answer))
	assert.Equal(t, python, answer.Interpreter)
	assert.Equal(t, shellQuote(python)+" "+shellQuote(filepath.Join(dir, "src", "train.py")), answer.Command)
}

// Without an environment of its own the shell decides, which is where an activated conda or pyenv is.
func TestWithoutAVenvTheShellsPython3Runs(t *testing.T) {
	terminals, dir := runTerminals(t)
	writeFile(t, filepath.Join(dir, "main.py"), 0o644)

	var answer RunCommand
	recorder := askRunCommand(t, terminals, "main.py")
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &answer))
	assert.Equal(t, "python3", answer.Interpreter)
	assert.Equal(t, "python3 "+shellQuote(filepath.Join(dir, "main.py")), answer.Command)
}

func TestOnlyAPythonFileInTheProjectCanBeRun(t *testing.T) {
	terminals, dir := runTerminals(t)
	writeFile(t, filepath.Join(dir, "notes.md"), 0o644)

	assert.Equal(t, http.StatusBadRequest, askRunCommand(t, terminals, "notes.md").Code)
	assert.Equal(t, http.StatusBadRequest, askRunCommand(t, terminals, "../outside.py").Code)
	assert.Equal(t, http.StatusNotFound, askRunCommand(t, terminals, "missing.py").Code)
}

func TestTheChosenPythonRunsTheFile(t *testing.T) {
	terminals, dir := runTerminals(t)
	writeFile(t, filepath.Join(dir, ".venv", "bin", "python3"), 0o755)
	writeFile(t, filepath.Join(dir, "main.py"), 0o644)
	chosen := filepath.Join(t.TempDir(), "python3.11")
	writeFile(t, chosen, 0o755)
	require.NoError(t, config.WriteConfig(&config.Config{PythonInterpreter: chosen}))

	var answer RunCommand
	recorder := askRunCommand(t, terminals, "main.py")
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &answer))
	assert.Equal(t, chosen, answer.Interpreter)
}

func TestShellQuote(t *testing.T) {
	for word, want := range map[string]string{
		"/home/me/project/main.py": "/home/me/project/main.py",
		"/home/me/my project/a.py": "'/home/me/my project/a.py'",
		"/tmp/it's.py":             `'/tmp/it'\''s.py'`,
		"/tmp/$HOME.py":            "'/tmp/$HOME.py'",
		"":                         "''",
	} {
		assert.Equal(t, want, shellQuote(word), word)
	}
}
