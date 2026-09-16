package content

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
)

func editsRequest(t *testing.T, project Project, files []FileEdits) *httptest.ResponseRecorder {
	t.Helper()

	body, err := json.Marshal(map[string]any{"files": files})
	assert.NoError(t, err)
	request := httptest.NewRequest(http.MethodPost, "/api/contents/edits", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	NewHandler(project).Edits(recorder, request)
	return recorder
}

func editResults(t *testing.T, response *httptest.ResponseRecorder) []EditResult {
	t.Helper()

	var answer struct {
		Files []EditResult `json:"files"`
	}
	assert.NoError(t, json.Unmarshal(response.Body.Bytes(), &answer))
	return answer.Files
}

func TestEditsRenamesEveryPlaceInAFile(t *testing.T) {
	project, projectDir := testProject(t)
	source := "package main\n\nfunc greet() {}\n\nvar _ = greet\n"
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "main.go"), []byte(source), 0o644))

	response := editsRequest(t, project, []FileEdits{{
		Path: "main.go",
		Edits: []TextEdit{
			{Start: Position{Line: 2, Character: 5}, End: Position{Line: 2, Character: 10}, NewText: "salute"},
			{Start: Position{Line: 4, Character: 8}, End: Position{Line: 4, Character: 13}, NewText: "salute"},
		},
	}})

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, []EditResult{{Path: "main.go", Applied: 2}}, editResults(t, response))
	after, err := os.ReadFile(filepath.Join(projectDir, "main.go"))
	assert.NoError(t, err)
	assert.Equal(t, "package main\n\nfunc salute() {}\n\nvar _ = salute\n", string(after))
}

// Two edits on one line: the later one must not be moved by the earlier one's new length.
func TestEditsOnOneLineDoNotMoveEachOther(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "a.go"), []byte("x = one + one\n"), 0o644))

	response := editsRequest(t, project, []FileEdits{{
		Path: "a.go",
		Edits: []TextEdit{
			{Start: Position{Line: 0, Character: 4}, End: Position{Line: 0, Character: 7}, NewText: "first"},
			{Start: Position{Line: 0, Character: 10}, End: Position{Line: 0, Character: 13}, NewText: "second"},
		},
	}})

	assert.Equal(t, http.StatusOK, response.Code)
	after, err := os.ReadFile(filepath.Join(projectDir, "a.go"))
	assert.NoError(t, err)
	assert.Equal(t, "x = first + second\n", string(after))
}

// The protocol's columns are UTF-16 code units, so a rune outside the basic plane counts as two.
func TestEditsCountColumnsInUtf16(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "b.py"), []byte("s = \"🐨\" + name\n"), 0o644))

	response := editsRequest(t, project, []FileEdits{{
		Path:  "b.py",
		Edits: []TextEdit{{Start: Position{Line: 0, Character: 11}, End: Position{Line: 0, Character: 15}, NewText: "who"}},
	}})

	assert.Equal(t, http.StatusOK, response.Code)
	after, err := os.ReadFile(filepath.Join(projectDir, "b.py"))
	assert.NoError(t, err)
	assert.Equal(t, "s = \"🐨\" + who\n", string(after))
}

// An insertion: start and end at the same place, which is how an import is added.
func TestEditsInsertWithoutReplacing(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "c.go"), []byte("package main\n\nfunc main() {}\n"), 0o644))

	response := editsRequest(t, project, []FileEdits{{
		Path:  "c.go",
		Edits: []TextEdit{{Start: Position{Line: 1, Character: 0}, End: Position{Line: 1, Character: 0}, NewText: "\nimport \"fmt\"\n"}},
	}})

	assert.Equal(t, http.StatusOK, response.Code)
	after, err := os.ReadFile(filepath.Join(projectDir, "c.go"))
	assert.NoError(t, err)
	assert.Equal(t, "package main\n\nimport \"fmt\"\n\nfunc main() {}\n", string(after))
}

func TestEditsKeepTheRestOfTheFilesWhenOneCannotBeEdited(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "good.go"), []byte("var a = 1\n"), 0o644))
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "book.ipynb"), []byte("{}"), 0o644))

	response := editsRequest(t, project, []FileEdits{
		{Path: "book.ipynb", Edits: []TextEdit{{NewText: "x"}}},
		{Path: "missing.go", Edits: []TextEdit{{NewText: "x"}}},
		{Path: "good.go", Edits: []TextEdit{{
			Start: Position{Line: 0, Character: 4}, End: Position{Line: 0, Character: 5}, NewText: "b",
		}}},
	})

	assert.Equal(t, http.StatusOK, response.Code)
	results := editResults(t, response)
	assert.Len(t, results, 3)
	assert.Contains(t, results[0].Error, "edited as cells")
	assert.NotEmpty(t, results[1].Error)
	assert.Equal(t, 1, results[2].Applied)
	after, err := os.ReadFile(filepath.Join(projectDir, "good.go"))
	assert.NoError(t, err)
	assert.Equal(t, "var b = 1\n", string(after))
}

func TestEditsRefuseAPathOutsideTheProject(t *testing.T) {
	project, _ := testProject(t)

	response := editsRequest(t, project, []FileEdits{{Path: "../escape.go", Edits: []TextEdit{{NewText: "x"}}}})

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Contains(t, editResults(t, response)[0].Error, "outside the project")
}

// A server answering about a version the file has moved past can name a line that is no longer there.
func TestEditsRefuseALineThatIsNotInTheFile(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "short.go"), []byte("one\n"), 0o644))

	response := editsRequest(t, project, []FileEdits{{
		Path:  "short.go",
		Edits: []TextEdit{{Start: Position{Line: 9}, End: Position{Line: 9}, NewText: "x"}},
	}})

	assert.Contains(t, editResults(t, response)[0].Error, "line 10")
	after, err := os.ReadFile(filepath.Join(projectDir, "short.go"))
	assert.NoError(t, err)
	assert.Equal(t, "one\n", string(after))
}
