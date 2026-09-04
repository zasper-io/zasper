/*
End-to-end journeys that start a real kernel.

Each one starts a Jupyter kernel process, talks to it, and stops it again, so they are the slow tests
here and they skip on a machine with no runnable kernelspec — see requireKernel. What they cover is the
part no unit test can reach: a session and its kernel are two records and one process, and the
interesting failures are the ones where those three stop agreeing.
*/
package server

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/kernelspec"
	"github.com/zasper-io/zasper/internal/models"
)

/*
requireKernel answers with the name of an installed Python kernelspec that can actually be run, and
skips the test when there is none.

Installed is not enough: a kernelspec whose virtualenv has been deleted is still listed, and starting
it fails with a fork/exec error. Python because these tests execute Python and read the answer back.
*/
func requireKernel(t *testing.T) string {
	t.Helper()

	specs := kernelspec.GetAllSpecs()

	names := make([]string, 0, len(specs))
	for name := range specs {
		names = append(names, name)
	}
	// Sorted, so a machine with several kernels uses the same one every run.
	sort.Strings(names)

	for _, name := range names {
		spec := specs[name].Spec
		if spec.Language != "python" || len(spec.Argv) == 0 {
			continue
		}
		if _, err := exec.LookPath(spec.Argv[0]); err != nil {
			continue
		}
		return name
	}

	t.Skip("no runnable Python kernelspec is installed")
	return ""
}

// startSession creates a notebook and a session on it, the way opening a notebook in the file browser
// does, and answers with the session.
func startSession(t *testing.T, srv *httptest.Server, project, kernelName, path string) models.SessionModel {
	t.Helper()

	require.NoError(t, os.WriteFile(filepath.Join(project, path), []byte(`{"cells":[]}`), 0o644))

	status, body := call(t, srv, http.MethodPost, "/api/sessions", map[string]any{
		"path": path, "name": filepath.Base(path), "type": "notebook",
		"kernel": map[string]string{"name": kernelName},
	})
	require.Equal(t, http.StatusCreated, status, "body was %s", body)

	created := decode[models.SessionModel](t, body)
	require.NotEmpty(t, created.Id)
	require.NotEmpty(t, created.Kernel.Id)

	return created
}

func TestASessionRunsAKernelUntilItIsDeleted(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)

	created := startSession(t, srv, project, kernelName, "notes.ipynb")

	status, body := call(t, srv, http.MethodGet, "/api/sessions", nil)
	require.Equal(t, http.StatusOK, status)
	listed := decode[map[string]models.SessionModel](t, body)
	require.Contains(t, listed, created.Id)
	assert.Equal(t, "notes.ipynb", listed[created.Id].Path)

	status, body = call(t, srv, http.MethodGet, "/api/kernels/"+created.Kernel.Id, nil)
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	assert.Equal(t, kernelName, decode[models.KernelModel](t, body).Name)

	status, body = call(t, srv, http.MethodGet, "/api/kernels", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Len(t, decode[[]models.KernelModel](t, body), 1)

	// An interrupt on an idle kernel is a SIGINT it shrugs off; what is under test is that it reaches
	// the kernel's own pid rather than the process group, which would take this test process with it.
	status, _ = call(t, srv, http.MethodPost, "/api/kernels/"+created.Kernel.Id+"/interrupt", nil)
	assert.Equal(t, http.StatusOK, status)

	status, _ = call(t, srv, http.MethodDelete, "/api/sessions/"+created.Id, nil)
	require.Equal(t, http.StatusOK, status)

	// The session and its kernel go together: a session list still naming a stopped kernel is what the
	// file browser would offer to reconnect to.
	status, body = call(t, srv, http.MethodGet, "/api/sessions", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Empty(t, decode[map[string]models.SessionModel](t, body))

	status, body = call(t, srv, http.MethodGet, "/api/kernels", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Empty(t, decode[[]models.KernelModel](t, body))

	status, _ = call(t, srv, http.MethodGet, "/api/kernels/"+created.Kernel.Id, nil)
	assert.Equal(t, http.StatusNotFound, status)
}

/*
An id that belongs to no kernel is answered, not acted on.

Interrupt is the one that mattered: the lookup did not check whether it found anything, and the zero
KernelManager has pid 0 — which on Unix means every process in this process group, so the request
SIGINT'd the server. Here that would be the test binary, so a regression fails this file rather than
this assertion.
*/
func TestAnUnknownKernelIdIsRefusedRatherThanActedOn(t *testing.T) {
	srv, _ := testServer(t)

	unknown := uuid.New().String()

	for _, request := range []struct {
		what   string
		method string
		path   string
	}{
		{"read", http.MethodGet, "/api/kernels/" + unknown},
		{"interrupt", http.MethodPost, "/api/kernels/" + unknown + "/interrupt"},
		{"stop", http.MethodPost, "/api/kernels/" + unknown + "/stop"},
		{"delete", http.MethodDelete, "/api/kernels/" + unknown},
		{"delete over ws route", http.MethodDelete, "/ws/kernels/" + unknown},
	} {
		t.Run(request.what, func(t *testing.T) {
			status, body := call(t, srv, request.method, request.path, nil)
			assert.Equal(t, http.StatusNotFound, status, "body was %s", body)
		})
	}

	// Deleting a session that is not there is the same answer, rather than a 500 from stopping the
	// zero kernel.
	status, _ := call(t, srv, http.MethodDelete, "/api/sessions/"+unknown, nil)
	assert.Equal(t, http.StatusNotFound, status)
}

/*
Two clients deleting the same session leave one kernel stopped and one 404.

Both used to succeed, and both stopped the kernel: the session was read, then deleted, so each request
came away with the same kernel id and signalled the same pid. A pid that has been reused by then
belongs to something else.
*/
func TestTwoDeletesOfTheSameSessionStopTheKernelOnce(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)

	created := startSession(t, srv, project, kernelName, "notes.ipynb")

	var racing sync.WaitGroup
	statuses := make([]int, 2)
	for i := range statuses {
		racing.Add(1)
		go func(i int) {
			defer racing.Done()
			statuses[i], _ = call(t, srv, http.MethodDelete, "/api/sessions/"+created.Id, nil)
		}(i)
	}
	racing.Wait()

	sort.Ints(statuses)
	assert.Equal(t, []int{http.StatusOK, http.StatusNotFound}, statuses,
		"exactly one delete should have owned the session")

	status, body := call(t, srv, http.MethodGet, "/api/kernels", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Empty(t, decode[[]models.KernelModel](t, body))
}

// A running notebook's session is keyed on its path, so a rename has to carry the session with it or
// the session list goes on naming a file that is not there.
func TestARenamedNotebookKeepsItsSession(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)

	created := startSession(t, srv, project, kernelName, "notes.ipynb")

	status, _ := call(t, srv, http.MethodPost, "/api/contents/rename", map[string]string{
		"parent_dir": "", "old_name": "notes.ipynb", "new_name": "renamed.ipynb",
	})
	require.Equal(t, http.StatusOK, status)

	status, body := call(t, srv, http.MethodGet, "/api/sessions", nil)
	require.Equal(t, http.StatusOK, status)
	moved := decode[map[string]models.SessionModel](t, body)[created.Id]
	assert.Equal(t, "renamed.ipynb", moved.Path)
	assert.Equal(t, "renamed.ipynb", moved.Name)
	// Same kernel: the file moved, the process did not.
	assert.Equal(t, created.Kernel.Id, moved.Kernel.Id)

	// And a move into a folder is followed the same way.
	require.NoError(t, os.Mkdir(filepath.Join(project, "work"), 0o755))
	status, _ = call(t, srv, http.MethodPost, "/api/contents/move", map[string]string{
		"from": "renamed.ipynb", "to": "work/renamed.ipynb",
	})
	require.Equal(t, http.StatusOK, status)

	status, body = call(t, srv, http.MethodGet, "/api/sessions", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "work/renamed.ipynb", decode[map[string]models.SessionModel](t, body)[created.Id].Path)
}

/*
Asking for a notebook that is already running joins its session rather than starting a second kernel.

This is what a reloaded page does: it has no session id, only the path it is open on. Left to start a
kernel of its own it would abandon the running one — with the notebook's variables, and the widgets
its outputs name, still inside it.
*/
func TestOpeningARunningNotebookAgainJoinsItsSession(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)

	created := startSession(t, srv, project, kernelName, "notes.ipynb")

	// The same request the reloaded page sends: a path and a kernel name, and nothing else.
	status, body := call(t, srv, http.MethodPost, "/api/sessions", map[string]any{
		"path": "notes.ipynb", "name": "notes.ipynb", "type": "notebook",
		"kernel": map[string]string{"name": kernelName},
	})
	require.Equal(t, http.StatusCreated, status, "body was %s", body)

	rejoined := decode[models.SessionModel](t, body)
	assert.Equal(t, created.Id, rejoined.Id)
	assert.Equal(t, created.Kernel.Id, rejoined.Kernel.Id)

	// One kernel, and one session on it: a second of either is one nothing is listening to.
	status, body = call(t, srv, http.MethodGet, "/api/kernels", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Len(t, decode[[]models.KernelModel](t, body), 1)

	status, body = call(t, srv, http.MethodGet, "/api/sessions", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Len(t, decode[map[string]models.SessionModel](t, body), 1)

	// A different notebook is a different session, path being what a session is found by.
	other := startSession(t, srv, project, kernelName, "other.ipynb")
	assert.NotEqual(t, created.Id, other.Id)
	assert.NotEqual(t, created.Kernel.Id, other.Kernel.Id)
}

/*
A cell is executed over the kernel websocket and the answer comes back.

The whole path: the shell channel carries the request, the kernel evaluates it, and iopub carries the
result to the socket the notebook is listening on. Every piece of this is mocked in the frontend tests.
*/
func TestCodeSentOverTheKernelSocketIsExecuted(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)

	created := startSession(t, srv, project, kernelName, "notes.ipynb")

	conn, _, err := websocket.DefaultDialer.Dial(
		wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels")+"?session_id="+created.Id, nil)
	require.NoError(t, err)
	defer conn.Close()

	msgId := uuid.New().String()
	require.NoError(t, conn.WriteJSON(map[string]any{
		"channel": "shell",
		"header": map[string]any{
			"msg_id": msgId, "msg_type": "execute_request", "session": created.Id,
			"username": "test", "version": kernel.ProtocolVersion,
			"date": time.Now().UTC().Format(time.RFC3339),
		},
		"parent_header": map[string]any{},
		"metadata":      map[string]any{},
		"content": map[string]any{
			"code": "1 + 1", "silent": false, "store_history": true,
			"user_expressions": map[string]any{}, "allow_stdin": true, "stop_on_error": true,
		},
	}))

	// Read until the result arrives rather than reading a fixed number of messages: a kernel also
	// reports its status and echoes the input, and how many of those come first is not fixed.
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(30*time.Second)))
	var result map[string]any
	for result == nil {
		_, raw, err := conn.ReadMessage()
		require.NoError(t, err, "no execute_result arrived")

		var message struct {
			Channel string `json:"channel"`
			Header  struct {
				MsgType string `json:"msg_type"`
			} `json:"header"`
			ParentHeader struct {
				MsgId string `json:"msg_id"`
			} `json:"parent_header"`
			Content map[string]any `json:"content"`
		}
		require.NoError(t, json.Unmarshal(raw, &message))

		if message.Header.MsgType == "execute_result" && message.ParentHeader.MsgId == msgId {
			assert.Equal(t, "iopub", message.Channel)
			result = message.Content
		}
	}

	data, ok := result["data"].(map[string]any)
	require.True(t, ok, "the result carried no data: %v", result)
	assert.Equal(t, "2", data["text/plain"])
}

// Killing the kernel out from under a notebook closes the socket it is listening on, rather than
// leaving it open on channels whose kernel is gone.
func TestKillingAKernelClosesTheSocketListeningOnIt(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)

	created := startSession(t, srv, project, kernelName, "notes.ipynb")

	conn, _, err := websocket.DefaultDialer.Dial(
		wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels")+"?session_id="+created.Id, nil)
	require.NoError(t, err)
	defer conn.Close()

	status, _ := call(t, srv, http.MethodDelete, "/api/kernels/"+created.Kernel.Id, nil)
	require.Equal(t, http.StatusOK, status)

	require.NoError(t, conn.SetReadDeadline(time.Now().Add(15*time.Second)))
	for {
		_, _, err := conn.ReadMessage()
		if err == nil {
			// The kernel's parting status messages may arrive before the close does.
			continue
		}
		// Any close will do; running out of read deadline means the socket never closed at all.
		var expired net.Error
		require.False(t, errors.As(err, &expired) && expired.Timeout(),
			"the socket stayed open after its kernel was killed")
		break
	}

	// Killing the kernel takes its session with it, so nothing offers to reconnect to it.
	status, body := call(t, srv, http.MethodGet, "/api/sessions", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Empty(t, decode[map[string]models.SessionModel](t, body))
}

// The socket refuses anything it cannot attach to a session and a running kernel, since a connection
// without either has no channels to carry.
func TestTheKernelSocketNeedsBothASessionAndAKernel(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)

	created := startSession(t, srv, project, kernelName, "notes.ipynb")

	for _, attempt := range []struct {
		what string
		url  string
	}{
		{"unknown session", wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels") + "?session_id=" + uuid.New().String()},
		{"no session at all", wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels")},
		{"unknown kernel", wsURL(t, srv, "/ws/kernels/"+uuid.New().String()+"/channels") + "?session_id=" + created.Id},
	} {
		t.Run(attempt.what, func(t *testing.T) {
			conn, answer, err := websocket.DefaultDialer.Dial(attempt.url, nil)
			if conn != nil {
				conn.Close()
			}
			require.Error(t, err, "the upgrade should have been refused")
			require.NotNil(t, answer)
			assert.Equal(t, http.StatusNotFound, answer.StatusCode)
		})
	}
}

func TestTheKernelspecsAreListed(t *testing.T) {
	srv, _ := testServer(t)
	kernelName := requireKernel(t)

	status, body := call(t, srv, http.MethodGet, "/api/kernelspecs", nil)
	require.Equal(t, http.StatusOK, status, "body was %s", body)

	listed := decode[kernelspec.KernelspecResponse](t, body)
	require.Contains(t, listed.Kernespecs, kernelName)
	assert.Equal(t, "python", listed.Kernespecs[kernelName].Spec.Language)

	status, body = call(t, srv, http.MethodGet, "/api/kernelspecs/"+kernelName, nil)
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	assert.Contains(t, string(body), kernelName)
}
