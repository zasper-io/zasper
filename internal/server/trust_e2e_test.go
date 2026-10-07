package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/kernelspec"
	"github.com/zasper-io/zasper/internal/trust"
)

func TestAnUntrustedProjectReadsButRunsNothingUntilItIsTrusted(t *testing.T) {
	kernelName := requireKernel(t)
	srv, project := untrustedServer(t)
	require.NoError(t, os.WriteFile(filepath.Join(project, "analysis.ipynb"),
		[]byte(`{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}`), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(project, "prepare.py"), []byte("print(1)\n"), 0o644))

	status, body := call(t, srv, http.MethodGet, "/api/trust", nil)
	require.Equal(t, http.StatusOK, status)
	state := decode[trust.State](t, body)
	assert.False(t, state.Trusted)
	resolved, _ := filepath.EvalSymlinks(project)
	assert.Equal(t, resolved, state.Folder)

	// Reading works.
	status, body = call(t, srv, http.MethodPost, "/api/contents",
		map[string]string{"path": "analysis.ipynb", "type": "notebook", "format": "text"})
	assert.Equal(t, http.StatusOK, status, "body was %s", body)

	// Running does not, and says why.
	sessionRequest := map[string]any{
		"path": "analysis.ipynb", "name": "analysis.ipynb", "type": "notebook",
		"kernel": map[string]string{"name": kernelName},
	}
	status, body = call(t, srv, http.MethodPost, "/api/sessions", sessionRequest)
	assert.Equal(t, http.StatusForbidden, status)
	var refused map[string]string
	require.NoError(t, json.Unmarshal(body, &refused))
	assert.Equal(t, "untrusted", refused["error"])

	status, _ = call(t, srv, http.MethodGet, "/api/terminals/run-command?path=prepare.py", nil)
	assert.Equal(t, http.StatusForbidden, status)
	status, _ = call(t, srv, http.MethodPost, "/api/environment/setup", nil)
	assert.Equal(t, http.StatusForbidden, status)

	// Git reads; it does not change the repository, where its own config could make it run commands.
	status, _ = call(t, srv, http.MethodGet, "/api/git/status", nil)
	assert.Equal(t, http.StatusOK, status)
	for _, write := range []string{"/api/git/stage", "/api/git/commit", "/api/git/checkout", "/api/git/pull", "/api/git/push", "/api/git/fetch"} {
		status, _ = call(t, srv, http.MethodPost, write, map[string]any{})
		assert.Equal(t, http.StatusForbidden, status, write)
	}

	// Trusting the folder that holds the project trusts the project.
	status, body = call(t, srv, http.MethodPost, "/api/trust", map[string]string{"path": filepath.Dir(project)})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	state = decode[trust.State](t, body)
	assert.True(t, state.Trusted)
	assert.Equal(t, trust.ByParent, state.By)

	status, body = call(t, srv, http.MethodPost, "/api/sessions", sessionRequest)
	require.Equal(t, http.StatusCreated, status, "body was %s", body)

	// Forgetting it restricts it again, and leaves the running kernel alone.
	status, body = call(t, srv, http.MethodDelete, "/api/trust", map[string]string{"path": state.Through})
	require.Equal(t, http.StatusOK, status)
	assert.False(t, decode[trust.State](t, body).Trusted)
	status, body = call(t, srv, http.MethodPost, "/api/sessions", sessionRequest)
	assert.Equal(t, http.StatusCreated, status, "the notebook rejoins the kernel it already has: %s", body)
}

func TestTheProjectsOwnVenvIsNotOfferedUntilTheProjectIsTrusted(t *testing.T) {
	srv, project := untrustedServer(t)
	python := filepath.Join(project, ".venv", "bin", "python3")
	require.NoError(t, os.MkdirAll(filepath.Dir(python), 0o755))
	require.NoError(t, os.WriteFile(python, []byte("#!/bin/sh\n"), 0o755))

	status, body := call(t, srv, http.MethodGet, "/api/interpreters", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Empty(t, decode[kernelspec.InterpreterChoice](t, body).Automatic,
		"a restricted project's .venv is not what a file runs with")
	status, body = call(t, srv, http.MethodGet, "/api/trust", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, python, decode[trust.State](t, body).Environment, "shown locked, as what trusting would start")

	call(t, srv, http.MethodPost, "/api/trust", map[string]string{"path": project})
	status, body = call(t, srv, http.MethodGet, "/api/interpreters", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, python, decode[kernelspec.InterpreterChoice](t, body).Automatic)
}
