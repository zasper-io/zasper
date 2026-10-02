package server

import (
	"encoding/json"
	"os"
	"path/filepath"
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
}

func jsonEscape(text string) string {
	encoded, _ := json.Marshal(text)
	return string(encoded[1 : len(encoded)-1])
}
