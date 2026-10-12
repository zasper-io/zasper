package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/kernel"
)

const countingCell = "import time\nfor i in range(3):\n    print(i, flush=True)\n    time.sleep(0.5)"

// awaitReplay reads the first message a new kernel socket is sent, which is the runs it missed.
func awaitReplay(t *testing.T, conn *websocket.Conn) kernel.Replay {
	t.Helper()

	require.NoError(t, conn.SetReadDeadline(time.Now().Add(30*time.Second)))
	_, raw, err := conn.ReadMessage()
	require.NoError(t, err)

	var message struct {
		Channel string `json:"channel"`
		Header  struct {
			MsgType string `json:"msg_type"`
		} `json:"header"`
		Content kernel.Replay `json:"content"`
	}
	require.NoError(t, json.Unmarshal(raw, &message))
	require.Equal(t, "zasper_replay", message.Header.MsgType, "the replay comes before anything else: %s", raw)
	assert.Equal(t, "zasper", message.Channel)
	return message.Content
}

// awaitOutputFrom reads until the run answering msgId has published some output.
func awaitOutputFrom(t *testing.T, conn *websocket.Conn, msgId string) {
	t.Helper()

	require.NoError(t, conn.SetReadDeadline(time.Now().Add(30*time.Second)))
	for {
		_, raw, err := conn.ReadMessage()
		require.NoError(t, err, "the run published nothing")

		var message struct {
			Header struct {
				MsgType string `json:"msg_type"`
			} `json:"header"`
			ParentHeader struct {
				MsgId string `json:"msg_id"`
			} `json:"parent_header"`
		}
		require.NoError(t, json.Unmarshal(raw, &message))
		if message.Header.MsgType == "stream" && message.ParentHeader.MsgId == msgId {
			return
		}
	}
}

func TestATabThatLosesItsSocketMidRunIsGivenWhatItMissed(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	created := startSession(t, srv, project, kernelName, "notes.ipynb")
	socketURL := wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels") + "?session_id=" + created.Id

	conn, _, err := websocket.DefaultDialer.Dial(socketURL, nil)
	require.NoError(t, err)
	assert.Empty(t, awaitReplay(t, conn).Runs)

	msgId := runCellOverSocket(t, conn, created.Id, "cell-1", countingCell)
	awaitOutputFrom(t, conn, msgId)
	require.NoError(t, conn.Close())

	time.Sleep(3 * time.Second)

	again, _, err := websocket.DefaultDialer.Dial(socketURL, nil)
	require.NoError(t, err)
	defer again.Close()

	replay := awaitReplay(t, again)
	require.Len(t, replay.Runs, 1)
	run := replay.Runs[0]
	assert.Equal(t, msgId, run.MsgID)
	assert.Equal(t, "cell-1", run.CellID)
	assert.True(t, run.Done)
	require.Len(t, run.Outputs, 1)
	assert.Equal(t, "0\n1\n2\n", run.Outputs[0]["text"])
}

func TestARunThatEndsWithNoTabOpenIsWrittenIntoTheNotebook(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	created := startSession(t, srv, project, kernelName, "train.ipynb")

	path := filepath.Join(project, "train.ipynb")
	require.NoError(t, os.WriteFile(path, []byte(`{"cells": [{"cell_type": "code", "id": "train",
		"execution_count": null, "metadata": {}, "outputs": [], "source": "`+jsonEscape(countingCell)+`"}],
		"metadata": {}, "nbformat": 4, "nbformat_minor": 5}`), 0o644))

	conn, _, err := websocket.DefaultDialer.Dial(
		wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels")+"?session_id="+created.Id, nil)
	require.NoError(t, err)
	awaitReplay(t, conn)
	msgId := runCellOverSocket(t, conn, created.Id, "train", countingCell)
	awaitOutputFrom(t, conn, msgId)
	require.NoError(t, conn.Close())

	assert.Eventually(t, func() bool {
		written := notebookIn(t, srv, "train.ipynb")
		cells := written["content"].(map[string]any)["cells"].([]any)
		cell := cells[0].(map[string]any)
		outputs, _ := cell["outputs"].([]any)
		if len(outputs) != 1 {
			return false
		}
		return outputs[0].(map[string]any)["text"] == "0\n1\n2\n" && cell["execution_count"] != nil
	}, 30*time.Second, 200*time.Millisecond, "the finished run's output never reached the file")

	// And when it ran, under JupyterLab's keys, since recording is on unless turned off.
	cell := notebookIn(t, srv, "train.ipynb")["content"].(map[string]any)["cells"].([]any)[0].(map[string]any)
	times, _ := cell["metadata"].(map[string]any)["execution"].(map[string]any)
	require.NotNil(t, times, "the run's times never reached the file")
	for _, key := range []string{"iopub.status.busy", "iopub.execute_input", "shell.execute_reply"} {
		assert.NotEmpty(t, times[key], key)
	}
	began, err := time.Parse(time.RFC3339Nano, times["iopub.execute_input"].(string))
	require.NoError(t, err)
	ended, err := time.Parse(time.RFC3339Nano, times["shell.execute_reply"].(string))
	require.NoError(t, err)
	assert.False(t, ended.Before(began), "a run cannot end before it began")
}

func jsonEscape(text string) string {
	encoded, _ := json.Marshal(text)
	return string(encoded[1 : len(encoded)-1])
}

func TestAnotherSocketIsToldWhichCellARunsOutputIsFor(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	created := startSession(t, srv, project, kernelName, "notes.ipynb")
	socketURL := wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels") + "?session_id=" + created.Id

	asking, _, err := websocket.DefaultDialer.Dial(socketURL, nil)
	require.NoError(t, err)
	defer asking.Close()
	watching, _, err := websocket.DefaultDialer.Dial(socketURL, nil)
	require.NoError(t, err)
	defer watching.Close()
	awaitReplay(t, asking)
	awaitReplay(t, watching)

	msgId := runCellOverSocket(t, asking, created.Id, "cell-1", "print('hi')")

	require.NoError(t, watching.SetReadDeadline(time.Now().Add(30*time.Second)))
	for {
		_, raw, err := watching.ReadMessage()
		require.NoError(t, err, "the other socket heard no output")
		var message struct {
			Header struct {
				MsgType string `json:"msg_type"`
			} `json:"header"`
			ParentHeader struct {
				MsgId string `json:"msg_id"`
			} `json:"parent_header"`
			Metadata map[string]interface{} `json:"metadata"`
		}
		require.NoError(t, json.Unmarshal(raw, &message))
		if message.Header.MsgType == "stream" && message.ParentHeader.MsgId == msgId {
			assert.Equal(t, "cell-1", message.Metadata["cellId"])
			return
		}
	}
}

func TestACellRunWithNoTabOpenAnswersItsOutputAndWritesItIntoTheNotebook(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	notebook := `{"cells": [{"cell_type": "code", "id": "c1", "metadata": {}, "source": "print('from the runner')", "outputs": [], "execution_count": null}],
	 "metadata": {"kernelspec": {"name": "` + kernelName + `", "display_name": "Python"}}, "nbformat": 4, "nbformat_minor": 5}`
	require.NoError(t, os.WriteFile(filepath.Join(project, "notes.ipynb"), []byte(notebook), 0o644))

	status, body := call(t, srv, http.MethodPost, "/api/runs", map[string]any{
		"path": "notes.ipynb", "cell_id": "c1", "client": "claude-code", "wait": 60,
	})

	require.Equal(t, http.StatusOK, status, "body was %s", body)
	run := decode[kernel.Run](t, body)
	assert.Equal(t, "c1", run.CellID)
	assert.Equal(t, "claude-code", run.Client)
	assert.True(t, run.Done)
	require.Len(t, run.Outputs, 1)
	assert.Equal(t, "from the runner\n", run.Outputs[0]["text"])

	assert.Eventually(t, func() bool {
		data, err := os.ReadFile(filepath.Join(project, "notes.ipynb"))
		return err == nil && strings.Contains(string(data), "from the runner")
	}, 10*time.Second, 100*time.Millisecond, "the output was not written into the notebook")
}

func TestARunOfACellTheNotebookDoesNotHaveIsNotFound(t *testing.T) {
	srv, project := testServer(t)
	require.NoError(t, os.WriteFile(filepath.Join(project, "notes.ipynb"),
		[]byte(`{"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}`), 0o644))

	status, _ := call(t, srv, http.MethodPost, "/api/runs", map[string]any{"path": "notes.ipynb", "cell_id": "nope"})

	assert.Equal(t, http.StatusNotFound, status)
}
