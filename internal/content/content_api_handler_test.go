package content

import (
	"bytes"
	"encoding/json"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zasper-io/zasper/internal/models"
)

func download(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(http.MethodGet, "/api/contents/download?path="+path, nil)
	recorder := httptest.NewRecorder()
	ContentDownloadAPIHandler(recorder, request)
	return recorder
}

func TestDownloadSendsTheFileAsAnAttachment(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "notes.txt"), []byte("hello"), 0o644))

	response := download(t, "notes.txt")

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "hello", response.Body.String())
	// Without this the browser renders the file instead of saving it.
	disposition, params, err := mime.ParseMediaType(response.Header().Get("Content-Disposition"))
	assert.NoError(t, err)
	assert.Equal(t, "attachment", disposition)
	assert.Equal(t, "notes.txt", params["filename"])
}

func TestDownloadKeepsANameThatIsNotPlainASCII(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "notes für mich.txt"), []byte("hi"), 0o644))

	response := download(t, "notes%20f%C3%BCr%20mich.txt")

	assert.Equal(t, http.StatusOK, response.Code)
	_, params, err := mime.ParseMediaType(response.Header().Get("Content-Disposition"))
	assert.NoError(t, err)
	assert.Equal(t, "notes für mich.txt", params["filename"])
}

func TestDownloadRefusesWhatItCannotSend(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	assert.NoError(t, os.Mkdir(filepath.Join(projectDir, "src"), 0o755))

	cases := map[string]struct {
		path string
		want int
	}{
		"nothing there":      {path: "missing.txt", want: http.StatusNotFound},
		"a folder":           {path: "src", want: http.StatusBadRequest},
		"outside the tree":   {path: "../elsewhere.txt", want: http.StatusBadRequest},
		"no path at all":     {path: "", want: http.StatusBadRequest},
		"an absolute escape": {path: "/etc/passwd", want: http.StatusNotFound},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, testCase.want, download(t, testCase.path).Code)
		})
	}
}

func upload(t *testing.T, fields map[string]string, name, body string) *httptest.ResponseRecorder {
	t.Helper()

	form := &bytes.Buffer{}
	writer := multipart.NewWriter(form)
	for field, value := range fields {
		assert.NoError(t, writer.WriteField(field, value))
	}
	part, err := writer.CreateFormFile("file", name)
	assert.NoError(t, err)
	_, err = part.Write([]byte(body))
	assert.NoError(t, err)
	assert.NoError(t, writer.Close())

	request := httptest.NewRequest(http.MethodPost, "/api/contents/upload", form)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	UploadFileHandler(recorder, request)
	return recorder
}

func TestUploadAnswersWithWhatItWrote(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	assert.NoError(t, os.Mkdir(filepath.Join(projectDir, "docs"), 0o755))

	response := upload(t, map[string]string{"parent_dir": "docs"}, "notes.txt", "hello")

	assert.Equal(t, http.StatusCreated, response.Code)
	var model models.ContentModel
	assert.NoError(t, json.Unmarshal(response.Body.Bytes(), &model))
	assert.Equal(t, "notes.txt", model.Name)
	assert.Equal(t, filepath.Join("docs", "notes.txt"), model.Path)
	written, err := os.ReadFile(filepath.Join(projectDir, "docs", "notes.txt"))
	assert.NoError(t, err)
	assert.Equal(t, "hello", string(written))
}

func TestUploadPutsAFolderUploadWhereItBelongs(t *testing.T) {
	projectDir := projectDirElsewhere(t)

	// The browser sends the part's own filename too; relative_path is the one that decides.
	response := upload(t, map[string]string{"relative_path": "notes/img/logo.png"}, "logo.png", "png")

	assert.Equal(t, http.StatusCreated, response.Code)
	assert.FileExists(t, filepath.Join(projectDir, "notes", "img", "logo.png"))
}

func TestUploadSaysWhenSomethingIsAlreadyThere(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "notes.txt"), []byte("keep"), 0o644))

	response := upload(t, nil, "notes.txt", "new")

	// A 409 is what lets the browser offer to replace rather than silently overwriting.
	assert.Equal(t, http.StatusConflict, response.Code)
	kept, err := os.ReadFile(filepath.Join(projectDir, "notes.txt"))
	assert.NoError(t, err)
	assert.Equal(t, "keep", string(kept))

	assert.Equal(t, http.StatusCreated, upload(t, map[string]string{"replace": "true"}, "notes.txt", "new").Code)
	replaced, err := os.ReadFile(filepath.Join(projectDir, "notes.txt"))
	assert.NoError(t, err)
	assert.Equal(t, "new", string(replaced))
}

func TestUploadRefusesAPathThatClimbsOut(t *testing.T) {
	projectDir := projectDirElsewhere(t)

	cases := map[string]map[string]string{
		"in the parent":   {"parent_dir": ".."},
		"in the filename": {"relative_path": "../escaped.txt"},
	}

	for name, fields := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, http.StatusBadRequest, upload(t, fields, "escaped.txt", "hello").Code)
			assert.NoFileExists(t, filepath.Join(filepath.Dir(projectDir), "escaped.txt"))
		})
	}
}

func TestUploadSaysWhenTheRequestCarriedNoFile(t *testing.T) {
	projectDirElsewhere(t)

	request := httptest.NewRequest(http.MethodPost, "/api/contents/upload", strings.NewReader(""))
	request.Header.Set("Content-Type", "multipart/form-data; boundary=nothing")
	recorder := httptest.NewRecorder()
	UploadFileHandler(recorder, request)

	assert.Equal(t, http.StatusBadRequest, recorder.Code)
}
