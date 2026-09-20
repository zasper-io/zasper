package server

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Two dots inside a name are part of the name: only a whole `..` segment climbs out of a folder.
func TestNamesWithDotsInThemAreNotTakenForTraversal(t *testing.T) {
	srv, project := testServer(t)
	require.NoError(t, os.WriteFile(filepath.Join(project, "notes...md"), []byte("hello"), 0o644))

	status, body := call(t, srv, http.MethodPost, "/api/contents", map[string]string{
		"path": "notes...md", "type": "file", "format": "text",
	})
	require.Equal(t, http.StatusOK, status, "body was %s", body)

	status, body = call(t, srv, http.MethodPut, "/api/contents", map[string]any{
		"path": "notes...md", "type": "file", "format": "text", "content": "saved",
	})
	require.Equal(t, http.StatusOK, status, "body was %s", body)

	status, body = call(t, srv, http.MethodPost, "/api/contents/rename", map[string]string{
		"parent_dir": "", "old_name": "notes...md", "new_name": "v1..2.md",
	})
	require.Equal(t, http.StatusOK, status, "body was %s", body)

	status, body = call(t, srv, http.MethodDelete, "/api/contents", map[string]string{"path": "v1..2.md"})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	assert.NoFileExists(t, filepath.Join(project, "v1..2.md"))
}

// A save of a type the server cannot write is refused, rather than answering 200 and writing nothing.
func TestASaveOfAnUnknownTypeIsRefused(t *testing.T) {
	srv, project := testServer(t)

	status, _ := call(t, srv, http.MethodPut, "/api/contents", map[string]any{
		"path": "notes.txt", "type": "text", "content": "lost",
	})

	assert.Equal(t, http.StatusBadRequest, status)
	assert.NoFileExists(t, filepath.Join(project, "notes.txt"))
}
