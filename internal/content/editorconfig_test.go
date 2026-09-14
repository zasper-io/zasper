package content

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func editorConfigFor(t *testing.T, project Project, path string) (int, EditorConfig) {
	t.Helper()

	request := httptest.NewRequest(http.MethodGet, "/api/contents/editorconfig?path="+url.QueryEscape(path), nil)
	recorder := httptest.NewRecorder()
	NewHandler(project).EditorConfig(recorder, request)

	var answer EditorConfig
	if recorder.Code == http.StatusOK {
		require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &answer))
	}
	return recorder.Code, answer
}

func TestAFileGetsTheEditorConfigSectionsThatMatchIt(t *testing.T) {
	project, dir := testProject(t)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "src"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".editorconfig"), []byte(`root = true

[*]
end_of_line = lf
insert_final_newline = true

[*.py]
indent_style = space
indent_size = 4

[Makefile]
indent_style = tab

[*.bat]
end_of_line = crlf
`), 0o644))

	status, python := editorConfigFor(t, project, "src/prepare.py")
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "space", python.IndentStyle)
	assert.Equal(t, 4, python.IndentSize)
	assert.Equal(t, "lf", python.EndOfLine)
	require.NotNil(t, python.InsertFinalNewline)
	assert.True(t, *python.InsertFinalNewline)

	_, makefile := editorConfigFor(t, project, "Makefile")
	assert.Equal(t, "tab", makefile.IndentStyle)

	_, batch := editorConfigFor(t, project, "run.bat")
	assert.Equal(t, "crlf", batch.EndOfLine)
}

// `indent_size = tab` is the tab's width, which is the number the editor needs.
func TestAnIndentSizeOfTabIsTheTabWidth(t *testing.T) {
	project, dir := testProject(t)
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".editorconfig"),
		[]byte("root = true\n\n[*]\nindent_style = tab\nindent_size = tab\ntab_width = 8\n"), 0o644))

	_, answer := editorConfigFor(t, project, "main.go")

	assert.Equal(t, 8, answer.IndentSize)
	assert.Equal(t, 8, answer.TabWidth)
}

func TestAFileNoEditorConfigCoversGetsNothing(t *testing.T) {
	project, dir := testProject(t)
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".editorconfig"),
		[]byte("root = true\n\n[*.py]\nindent_size = 4\n"), 0o644))

	status, answer := editorConfigFor(t, project, "notes.txt")

	assert.Equal(t, http.StatusOK, status)
	assert.Equal(t, EditorConfig{}, answer)
}

func TestEditorConfigIsOnlyAnsweredForAFileInsideTheProject(t *testing.T) {
	project, _ := testProject(t)

	status, _ := editorConfigFor(t, project, "../elsewhere.py")
	assert.Equal(t, http.StatusBadRequest, status)

	status, _ = editorConfigFor(t, project, "")
	assert.Equal(t, http.StatusBadRequest, status)
}
