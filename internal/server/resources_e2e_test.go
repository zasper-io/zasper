package server

import (
	"net/http"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/resources"
)

// A worker the kernel starts, holding 200 MB it has written to, so the pages are resident.
const workerCell = `
import subprocess, sys
worker = subprocess.Popen([sys.executable, "-c", "x = b'x' * (200 << 20); import time; time.sleep(120)"])
worker.pid`

func TestAKernelsMemoryCountsTheProcessesItStarted(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	created := startSession(t, srv, project, kernelName, "train.ipynb")

	conn, _, err := websocket.DefaultDialer.Dial(
		wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels")+"?session_id="+created.Id, nil)
	require.NoError(t, err)
	defer conn.Close()

	read := func() resources.Snapshot {
		status, body := call(t, srv, http.MethodGet, "/api/kernels/resources", nil)
		require.Equal(t, http.StatusOK, status, "body was %s", body)
		return decode[resources.Snapshot](t, body)
	}

	before, ok := read().Kernels[created.Kernel.Id]
	require.True(t, ok, "the kernel is listed by its id")
	assert.Positive(t, before.Processes)

	msgId := executeOverSocket(t, conn, created.Id, workerCell)
	awaitExecuteResult(t, conn, msgId, 60*time.Second)
	defer func() {
		msgId := executeOverSocket(t, conn, created.Id, "worker.kill() or worker.wait()")
		awaitExecuteResult(t, conn, msgId, 30*time.Second)
	}()

	var after resources.Usage
	require.Eventually(t, func() bool {
		after = read().Kernels[created.Kernel.Id]
		return after.Memory >= before.Memory+200<<20
	}, 20*time.Second, 250*time.Millisecond, "the worker's 200 MB is the kernel's")
	assert.Equal(t, before.Processes+1, after.Processes)

	snapshot := read()
	require.NotNil(t, snapshot.Memory, "this machine's memory is read")
	assert.Greater(t, snapshot.Memory.Total, after.Memory)
	assert.NotNil(t, snapshot.GPUs)
}
