/*
End-to-end journeys over the real route table.

Every other Go test in this repo calls one handler with an httptest.Recorder. These go through the
router a browser talks to — path patterns, methods, the websocket upgrade — and follow a whole journey
rather than a single call, because the defects worth catching here live between the calls: a session
that keeps naming a file that has been renamed, two deletes that both stop the same kernel, a path that
escapes the project on write but not on read.

core.Zasper and the kernel, session, connection and watcher stores are process-wide, so nothing here
runs in parallel.
*/
package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/models"
	"github.com/zasper-io/zasper/internal/session"
)

/*
testServer starts the real route table over a throwaway project directory and answers with the server
and that directory.

The project sits one level below the temp root, so a test can put something outside the project and
prove no request reaches it — filepath.Dir of the returned path is that root.

The SPA handler is nil: it embeds ui/build, which a test has no business serving.
*/
func testServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()

	project := filepath.Join(t.TempDir(), "project")
	require.NoError(t, os.MkdirAll(project, 0o755))

	core.Zasper = core.SetUpZasper("test", project, false)
	SetUp()

	srv := httptest.NewServer(NewRouter(nil))
	t.Cleanup(func() {
		// Sessions first, and before the server closes: each one owns a kernel process, and neither
		// closing the server nor emptying the store would stop it.
		for id := range session.ListSessions() {
			if err := session.DeleteSession(models.SessionModel{Id: id}); err != nil {
				t.Errorf("could not clean up session %s: %v", id, err)
			}
		}
		srv.Close()
	})

	return srv, project
}

// call sends a JSON request and answers with the status and the raw body: several journeys are about
// the status alone, and the bodies that matter differ per endpoint.
func call(t *testing.T, srv *httptest.Server, method, path string, payload any) (int, []byte) {
	t.Helper()

	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		require.NoError(t, err)
		body = bytes.NewReader(encoded)
	}

	req, err := http.NewRequest(method, srv.URL+path, body)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	answer, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer answer.Body.Close()

	answered, err := io.ReadAll(answer.Body)
	require.NoError(t, err)
	return answer.StatusCode, answered
}

func decode[T any](t *testing.T, body []byte) T {
	t.Helper()

	var decoded T
	require.NoError(t, json.Unmarshal(body, &decoded), "body was %s", body)
	return decoded
}

// notebookIn reads a notebook the way the editor does, and answers with the whole content model so a
// test can send it straight back on a save.
func notebookIn(t *testing.T, srv *httptest.Server, path string) map[string]any {
	t.Helper()

	status, body := call(t, srv, http.MethodPost, "/api/contents", map[string]string{
		"path": path, "type": "notebook", "format": "text",
	})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	return decode[map[string]any](t, body)
}

func TestANotebookIsCreatedReadUpdatedRenamedMovedCopiedAndDeleted(t *testing.T) {
	srv, project := testServer(t)

	status, body := call(t, srv, http.MethodPost, "/api/contents/create", map[string]string{
		"type": "notebook", "parent_dir": "",
	})
	require.Equal(t, http.StatusCreated, status, "body was %s", body)
	created := decode[models.ContentModel](t, body)
	assert.Equal(t, "Untitled.ipynb", created.Name)
	assert.Equal(t, "Untitled.ipynb", created.Path)
	assert.FileExists(t, filepath.Join(project, "Untitled.ipynb"))

	notebook := notebookIn(t, srv, "Untitled.ipynb")
	document := notebook["content"].(map[string]any)
	// A new notebook is written with no cells at all; the blank code cell the reader sees is the
	// editor's, and only reaches the file on the first save.
	require.Empty(t, document["cells"])

	// Saved as the editor saves: the content model straight back, with the cell it added.
	document["cells"] = []any{map[string]any{
		"cell_type": "code", "source": "1 + 1",
		"metadata": map[string]any{}, "outputs": []any{}, "execution_count": nil,
	}}
	status, body = call(t, srv, http.MethodPut, "/api/contents", map[string]any{
		"path": "Untitled.ipynb", "type": "notebook", "format": "text",
		"content": document,
	})
	require.Equal(t, http.StatusOK, status, "body was %s", body)

	reread := notebookIn(t, srv, "Untitled.ipynb")
	saved := reread["content"].(map[string]any)["cells"].([]any)[0].(map[string]any)
	assert.Equal(t, "1 + 1", saved["source"])

	status, _ = call(t, srv, http.MethodPost, "/api/contents/rename", map[string]string{
		"parent_dir": "", "old_name": "Untitled.ipynb", "new_name": "notes.ipynb",
	})
	require.Equal(t, http.StatusOK, status)
	assert.FileExists(t, filepath.Join(project, "notes.ipynb"))
	assert.NoFileExists(t, filepath.Join(project, "Untitled.ipynb"))

	status, body = call(t, srv, http.MethodPost, "/api/contents/create", map[string]string{
		"type": "directory", "parent_dir": "",
	})
	require.Equal(t, http.StatusCreated, status, "body was %s", body)
	folder := decode[models.ContentModel](t, body).Path

	status, _ = call(t, srv, http.MethodPost, "/api/contents/move", map[string]string{
		"from": "notes.ipynb", "to": filepath.Join(folder, "notes.ipynb"),
	})
	require.Equal(t, http.StatusOK, status)
	assert.FileExists(t, filepath.Join(project, folder, "notes.ipynb"))

	// A copy back into the root arrives under its own name, since nothing there is called that yet.
	status, body = call(t, srv, http.MethodPost, "/api/contents/copy", map[string]string{
		"from": filepath.Join(folder, "notes.ipynb"), "to_dir": "",
	})
	require.Equal(t, http.StatusCreated, status, "body was %s", body)
	assert.Equal(t, "notes.ipynb", decode[models.ContentModel](t, body).Name)

	// The edit survived the rename, the move and the copy.
	copied := notebookIn(t, srv, "notes.ipynb")
	assert.Equal(t,
		"1 + 1",
		copied["content"].(map[string]any)["cells"].([]any)[0].(map[string]any)["source"],
	)

	status, _ = call(t, srv, http.MethodDelete, "/api/contents", map[string]string{"path": "notes.ipynb"})
	require.Equal(t, http.StatusOK, status)
	assert.NoFileExists(t, filepath.Join(project, "notes.ipynb"))

	// And what is gone is 404 rather than 200 with nothing in it.
	status, _ = call(t, srv, http.MethodPost, "/api/contents", map[string]string{
		"path": "notes.ipynb", "type": "notebook", "format": "text",
	})
	assert.Equal(t, http.StatusNotFound, status)
	status, _ = call(t, srv, http.MethodDelete, "/api/contents", map[string]string{"path": "notes.ipynb"})
	assert.Equal(t, http.StatusNotFound, status)
}

func TestTheSameNameTwiceIsAConflictRatherThanAnOverwrite(t *testing.T) {
	srv, project := testServer(t)

	for _, name := range []string{"a.txt", "b.txt"} {
		require.NoError(t, os.WriteFile(filepath.Join(project, name), []byte(name), 0o644))
	}

	status, body := call(t, srv, http.MethodPost, "/api/contents/rename", map[string]string{
		"parent_dir": "", "old_name": "a.txt", "new_name": "b.txt",
	})
	assert.Equal(t, http.StatusConflict, status, "body was %s", body)

	status, _ = call(t, srv, http.MethodPost, "/api/contents/move", map[string]string{
		"from": "a.txt", "to": "b.txt",
	})
	assert.Equal(t, http.StatusConflict, status)

	// Neither file was touched by either refusal.
	for _, name := range []string{"a.txt", "b.txt"} {
		kept, err := os.ReadFile(filepath.Join(project, name))
		require.NoError(t, err)
		assert.Equal(t, name, string(kept))
	}

	status, _ = call(t, srv, http.MethodPost, "/api/contents/rename", map[string]string{
		"parent_dir": "", "old_name": "a.txt", "new_name": "sub/a.txt",
	})
	assert.Equal(t, http.StatusBadRequest, status, "a rename names a sibling, not a path")
}

/*
Nothing reaches outside the project directory.

Every write endpoint roots its path through GetSafePath, and the handlers refuse `..` before that;
this checks both halves at once by keeping a file in the temp root, one level above the project, and
asserting after every attempt that it is exactly as it was.
*/
func TestNoRequestReachesOutsideTheProjectDirectory(t *testing.T) {
	srv, project := testServer(t)

	outside := filepath.Join(filepath.Dir(project), "secret.txt")
	require.NoError(t, os.WriteFile(outside, []byte("private"), 0o644))

	escapes := []struct {
		what    string
		method  string
		path    string
		payload any
	}{
		{"read", http.MethodPost, "/api/contents", map[string]string{"path": "../secret.txt", "type": "file", "format": "text"}},
		{"write", http.MethodPut, "/api/contents", map[string]any{"path": "../secret.txt", "type": "file", "format": "text", "content": "overwritten"}},
		{"create", http.MethodPost, "/api/contents/create", map[string]string{"type": "notebook", "parent_dir": ".."}},
		{"delete", http.MethodDelete, "/api/contents", map[string]string{"path": "../secret.txt"}},
		{"rename out", http.MethodPost, "/api/contents/rename", map[string]string{"parent_dir": "..", "old_name": "secret.txt", "new_name": "taken.txt"}},
		{"move out", http.MethodPost, "/api/contents/move", map[string]string{"from": "../secret.txt", "to": "taken.txt"}},
		{"copy out", http.MethodPost, "/api/contents/copy", map[string]string{"from": "../secret.txt", "to_dir": ""}},
		{"download", http.MethodGet, "/api/contents/download?path=../secret.txt", nil},
	}

	for _, escape := range escapes {
		t.Run(escape.what, func(t *testing.T) {
			status, body := call(t, srv, escape.method, escape.path, escape.payload)
			assert.Equal(t, http.StatusBadRequest, status, "body was %s", body)
			assert.NotContains(t, string(body), "private")
		})
	}

	t.Run("upload", func(t *testing.T) {
		status, body := upload(t, srv, "..", "secret.txt", "overwritten")
		assert.Equal(t, http.StatusBadRequest, status, "body was %s", body)
	})

	// An absolute path is not an escape either: it is joined onto the project directory, so it names
	// something inside that is simply not there.
	t.Run("absolute path", func(t *testing.T) {
		status, body := call(t, srv, http.MethodPost, "/api/contents", map[string]string{
			"path": "/etc/passwd", "type": "file", "format": "text",
		})
		assert.Equal(t, http.StatusNotFound, status)
		assert.NotContains(t, string(body), "root:")
	})

	kept, err := os.ReadFile(outside)
	require.NoError(t, err)
	assert.Equal(t, "private", string(kept), "the file above the project was written to")
	assert.NoFileExists(t, filepath.Join(project, "taken.txt"))
}

func TestAnUploadLandsInTheProjectAndWillNotSilentlyReplace(t *testing.T) {
	srv, project := testServer(t)

	status, body := upload(t, srv, "", "data.csv", "a,b\n1,2\n")
	require.Equal(t, http.StatusCreated, status, "body was %s", body)

	written, err := os.ReadFile(filepath.Join(project, "data.csv"))
	require.NoError(t, err)
	assert.Equal(t, "a,b\n1,2\n", string(written))

	status, _ = upload(t, srv, "", "data.csv", "replaced")
	assert.Equal(t, http.StatusConflict, status)

	written, err = os.ReadFile(filepath.Join(project, "data.csv"))
	require.NoError(t, err)
	assert.Equal(t, "a,b\n1,2\n", string(written), "the refused upload overwrote the file anyway")

	// Downloading answers with the bytes and a filename the browser can use.
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/contents/download?path=data.csv", nil)
	require.NoError(t, err)
	answer, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer answer.Body.Close()

	downloaded, err := io.ReadAll(answer.Body)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, answer.StatusCode)
	assert.Equal(t, "a,b\n1,2\n", string(downloaded))
	assert.Contains(t, answer.Header.Get("Content-Disposition"), `filename=data.csv`)
}

// upload posts one file the way the file browser does, as multipart with the parent directory and the
// path inside it as form fields.
func upload(t *testing.T, srv *httptest.Server, parentDir, name, body string) (int, []byte) {
	t.Helper()

	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	require.NoError(t, writer.WriteField("parent_dir", parentDir))
	require.NoError(t, writer.WriteField("relative_path", name))
	part, err := writer.CreateFormFile("file", filepath.Base(name))
	require.NoError(t, err)
	_, err = part.Write([]byte(body))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	answer, err := srv.Client().Post(srv.URL+"/api/contents/upload", writer.FormDataContentType(), &form)
	require.NoError(t, err)
	defer answer.Body.Close()

	answered, err := io.ReadAll(answer.Body)
	require.NoError(t, err)
	return answer.StatusCode, answered
}

/*
Every open watch socket hears about a change.

Two clients at once is the case that used to kill the server: each connection joined the store under
its own mutex, which guards nothing shared. It also proves the fan-out, which no unit test can — one
fsnotify watcher per connection, each writing to its own socket.
*/
func TestEveryWatchSocketIsToldToReload(t *testing.T) {
	srv, project := testServer(t)

	watches := []*websocket.Conn{watchSocket(t, srv), watchSocket(t, srv)}

	// The watcher goroutine starts after the socket is accepted, so a change made straight away can
	// land before anything is watching. Changes keep coming until every client has heard one, which is
	// what makes this a wait rather than a guess.
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			os.WriteFile(filepath.Join(project, "touched.txt"), []byte(fmt.Sprint(i)), 0o644)
			time.Sleep(50 * time.Millisecond)
		}
	}()

	for i, watch := range watches {
		require.NoError(t, watch.SetReadDeadline(time.Now().Add(15*time.Second)))
		_, message, err := watch.ReadMessage()
		require.NoError(t, err, "watch socket %d heard nothing", i)
		assert.Equal(t, "reload", string(message))
	}
}

func watchSocket(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()

	conn, _, err := websocket.DefaultDialer.Dial(wsURL(t, srv, "/api/contents/watch"), nil)
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })

	return conn
}

func wsURL(t *testing.T, srv *httptest.Server, path string) string {
	t.Helper()

	parsed, err := url.Parse(srv.URL)
	require.NoError(t, err)
	parsed.Scheme = "ws"
	parsed.Path = path

	return parsed.String()
}

func TestTheServerDescribesItself(t *testing.T) {
	srv, project := testServer(t)

	status, _ := call(t, srv, http.MethodGet, "/api/health", nil)
	assert.Equal(t, http.StatusOK, status)

	status, body := call(t, srv, http.MethodGet, "/api/config", nil)
	require.Equal(t, http.StatusOK, status)
	config := decode[ConfigResponse](t, body)
	assert.Equal(t, "test", config.Version)
	assert.False(t, config.Protected)

	status, body = call(t, srv, http.MethodGet, "/api/info", nil)
	require.Equal(t, http.StatusOK, status)
	info := decode[InfoResponse](t, body)
	assert.Equal(t, filepath.Base(project), info.ProjectName)
	assert.Equal(t, "test", info.Version)

	// Not a route, rather than the SPA's index.html: this router was built without one.
	status, _ = call(t, srv, http.MethodGet, "/api/nothing-here", nil)
	assert.Equal(t, http.StatusNotFound, status)

	// Right path, wrong method.
	status, _ = call(t, srv, http.MethodDelete, "/api/health", nil)
	assert.Equal(t, http.StatusMethodNotAllowed, status)
}
