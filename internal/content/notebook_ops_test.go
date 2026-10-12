package content

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/nbformat"
)

const opsNotebook = `{"cells": [
 {"cell_type": "code", "id": "a", "metadata": {}, "source": "load()", "outputs": [], "execution_count": 1},
 {"cell_type": "code", "id": "b", "metadata": {}, "source": "fit()", "outputs": [], "execution_count": null}
], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}`

func opsProject(t *testing.T, notebook string) (Project, string) {
	t.Helper()
	project, projectDir := testProject(t)
	require.NoError(t, os.WriteFile(filepath.Join(projectDir, "drift.ipynb"), []byte(notebook), 0o644))
	return project, projectDir
}

// sourcesOf reads the notebook back as id:source pairs, in order.
func sourcesOf(t *testing.T, projectDir string) []string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(projectDir, "drift.ipynb"))
	require.NoError(t, err)
	doc, err := nbformat.Read(data)
	require.NoError(t, err)
	var out []string
	for _, cell := range doc.Cells() {
		out = append(out, cell["id"].(string)+":"+cell["source"].(string))
	}
	return out
}

func TestNotebookOpsEditInsertMoveAndDeleteCellsByID(t *testing.T) {
	project, projectDir := opsProject(t, opsNotebook)

	hash, inserted, err := project.ApplyNotebookOps("drift.ipynb", []NotebookOp{
		{Op: "edit", ID: "a", Source: `load("clean")`},
		{Op: "insert", After: "b", CellType: "code", Source: "plot()"},
		{Op: "move", ID: "b", After: ""},
	})

	require.NoError(t, err)
	require.Len(t, inserted, 1)
	assert.Equal(t, []string{"b:fit()", `a:load("clean")`, inserted[0] + ":plot()"}, sourcesOf(t, projectDir))
	data, _ := os.ReadFile(filepath.Join(projectDir, "drift.ipynb"))
	assert.Equal(t, contentHash(data), hash)

	_, _, err = project.ApplyNotebookOps("drift.ipynb", []NotebookOp{{Op: "delete", ID: "b"}})
	require.NoError(t, err)
	assert.Equal(t, []string{`a:load("clean")`, inserted[0] + ":plot()"}, sourcesOf(t, projectDir))
}

func TestCellsInsertedTogetherGetTheirOwnIDs(t *testing.T) {
	project, _ := opsProject(t, opsNotebook)

	_, inserted, err := project.ApplyNotebookOps("drift.ipynb", []NotebookOp{
		{Op: "insert", CellType: "markdown", Source: "# One"},
		{Op: "insert", CellType: "code", Source: "two()"},
	})

	require.NoError(t, err)
	require.Len(t, inserted, 2)
	assert.NotEqual(t, inserted[0], inserted[1])
}

func TestNotebookOpsWriteNothingWhenOneCannotBeCarriedOut(t *testing.T) {
	project, projectDir := opsProject(t, opsNotebook)
	before := sourcesOf(t, projectDir)

	_, _, err := project.ApplyNotebookOps("drift.ipynb", []NotebookOp{
		{Op: "edit", ID: "a", Source: "changed()"},
		{Op: "edit", ID: "missing", Source: "x"},
	})

	assert.ErrorContains(t, err, `no cell has the id "missing"`)
	assert.Equal(t, before, sourcesOf(t, projectDir))
}

func TestNotebookOpsNeedCellIDs(t *testing.T) {
	old := `{"cells": [{"cell_type": "code", "metadata": {}, "source": "x", "outputs": [], "execution_count": null}], "metadata": {}, "nbformat": 4, "nbformat_minor": 4}`
	project, _ := opsProject(t, old)

	_, _, err := project.ApplyNotebookOps("drift.ipynb", []NotebookOp{{Op: "edit", ID: "a", Source: "y"}})

	assert.ErrorIs(t, err, ErrNoCellIDs)
}

func TestNotebookOpsOverAChangeNotSeenAreRefused(t *testing.T) {
	project, projectDir := opsProject(t, opsNotebook)
	body := `{"path": "drift.ipynb", "hash": "stale", "ops": [{"op": "edit", "id": "a", "source": "x"}]}`

	recorder := httptest.NewRecorder()
	NewHandler(project).NotebookOps(recorder, httptest.NewRequest(http.MethodPost, "/api/contents/ops", strings.NewReader(body)))

	assert.Equal(t, http.StatusConflict, recorder.Code)
	assert.Contains(t, sourcesOf(t, projectDir), "a:load()")
}

func TestAnOpenTabIsToldWhoChangedItsNotebook(t *testing.T) {
	project, projectDir := opsProject(t, opsNotebook)
	handler := NewHandler(project)
	subscriber, err := handler.watch.subscribe()
	require.NoError(t, err)
	t.Cleanup(func() { handler.watch.unsubscribe(subscriber) })
	handler.watch.want(subscriber, []string{"drift.ipynb"})
	settle(subscriber)
	handler.watch.take(subscriber)

	body := `{"path": "drift.ipynb", "client": "claude-code", "ops": [{"op": "edit", "id": "a", "source": "x"}]}`
	recorder := httptest.NewRecorder()
	handler.NotebookOps(recorder, httptest.NewRequest(http.MethodPost, "/api/contents/ops", strings.NewReader(body)))
	require.Equal(t, http.StatusOK, recorder.Code)
	var result NotebookOpsResult
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &result))
	settle(subscriber)

	var message watchMessage
	require.NoError(t, json.Unmarshal(handler.watch.take(subscriber), &message))
	require.NotEmpty(t, message.Changed)
	for _, change := range message.Changed {
		if change.Path == "drift.ipynb" {
			assert.Equal(t, result.Hash, *change.Hash)
			assert.Equal(t, "claude-code", change.By)
			return
		}
	}
	t.Fatalf("the notebook's change was not reported: %+v (project %s)", message, projectDir)
}
