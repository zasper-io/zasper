package kernel

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/go-zeromq/zmq4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// An empty key, which signedBy accepts unsigned.
func journalKernel() *KernelManager {
	return &KernelManager{KernelId: "k1"}
}

func iopub(t *testing.T, parent, msgType string, content map[string]interface{}) zmq4.Msg {
	t.Helper()
	frame := func(value interface{}) []byte {
		encoded, err := json.Marshal(value)
		require.NoError(t, err)
		return encoded
	}
	return zmq4.NewMsgFrom(
		[]byte(DELIM), []byte(""),
		frame(MessageHeader{MsgID: newID(), MsgType: msgType}),
		frame(MessageHeader{MsgID: parent}),
		frame(map[string]interface{}{}),
		frame(content),
	)
}

func publishAll(km *KernelManager, steps ...zmq4.Msg) {
	for _, step := range steps {
		km.publish(step)
	}
}

func idle(t *testing.T, parent string) zmq4.Msg {
	return iopub(t, parent, "status", map[string]interface{}{"execution_state": "idle"})
}

func TestOutputPublishedWithNobodyAttachedIsReplayedToTheNextClientOnce(t *testing.T) {
	km := journalKernel()
	km.BeginRun("m1", "cell-1", "print('hi')")

	publishAll(km,
		iopub(t, "m1", "execute_input", map[string]interface{}{"execution_count": 3}),
		iopub(t, "m1", "stream", map[string]interface{}{"name": "stdout", "text": "hel"}),
		iopub(t, "m1", "stream", map[string]interface{}{"name": "stdout", "text": "lo\n"}),
		iopub(t, "m1", "execute_result", map[string]interface{}{"data": map[string]interface{}{"text/plain": "1"}}),
		idle(t, "m1"),
	)

	first := km.Subscribe()
	require.Len(t, first.Replay.Runs, 1)
	run := first.Replay.Runs[0]
	assert.Equal(t, "cell-1", run.CellID)
	assert.True(t, run.Done)
	assert.EqualValues(t, 3, run.ExecutionCount)
	require.Len(t, run.Outputs, 2)
	assert.Equal(t, "hello\n", run.Outputs[0]["text"])
	assert.EqualValues(t, 3, run.Outputs[1]["execution_count"])
	assert.Equal(t, map[string]interface{}{}, run.Outputs[1]["metadata"])

	assert.Empty(t, km.Subscribe().Replay.Runs)
}

func TestARunAClientWatchedToTheEndIsNotReplayed(t *testing.T) {
	km := journalKernel()
	watching := km.Subscribe()
	km.BeginRun("m1", "cell-1", "1")

	publishAll(km,
		iopub(t, "m1", "stream", map[string]interface{}{"name": "stdout", "text": "x"}),
		idle(t, "m1"),
	)
	km.Unsubscribe(watching)

	assert.Empty(t, km.Subscribe().Replay.Runs)
}

func TestAClientJoiningMidRunIsReplayedTheStartAndSentTheRest(t *testing.T) {
	km := journalKernel()
	km.BeginRun("m1", "cell-1", "train()")
	km.publish(iopub(t, "m1", "stream", map[string]interface{}{"name": "stdout", "text": "epoch 1\n"}))

	joined := km.Subscribe()
	require.Len(t, joined.Replay.Runs, 1)
	assert.False(t, joined.Replay.Runs[0].Done)
	assert.Equal(t, "epoch 1\n", joined.Replay.Runs[0].Outputs[0]["text"])

	km.publish(iopub(t, "m1", "stream", map[string]interface{}{"name": "stdout", "text": "epoch 2\n"}))
	assert.Contains(t, string(<-joined.Messages), "epoch 2")
	assert.Equal(t, "epoch 1\n", joined.Replay.Runs[0].Outputs[0]["text"], "the replay is a copy")
}

func TestAClearThatWaitsIsReplacedByTheNextOutput(t *testing.T) {
	km := journalKernel()
	km.BeginRun("m1", "cell-1", "loop()")

	publishAll(km,
		iopub(t, "m1", "stream", map[string]interface{}{"name": "stdout", "text": "10%"}),
		iopub(t, "m1", "clear_output", map[string]interface{}{"wait": true}),
	)
	peek := km.Subscribe()
	pending := peek.Replay.Runs[0]
	assert.True(t, pending.ClearWaiting)
	assert.Len(t, pending.Outputs, 1)
	km.Unsubscribe(peek)

	publishAll(km,
		iopub(t, "m1", "stream", map[string]interface{}{"name": "stdout", "text": "20%"}),
		idle(t, "m1"),
	)
	ended := km.Subscribe().Replay.Runs[0]
	assert.False(t, ended.ClearWaiting)
	require.Len(t, ended.Outputs, 1)
	assert.Equal(t, "20%", ended.Outputs[0]["text"])
}

func TestOnlyARunThatEndsWithNobodyAttachedIsReportedFinished(t *testing.T) {
	km := journalKernel()
	var finished []Run
	km.feed.finished = func(run Run) { finished = append(finished, run) }

	km.BeginRun("alone", "cell-1", "1")
	publishAll(km,
		iopub(t, "alone", "stream", map[string]interface{}{"name": "stdout", "text": "x"}),
		idle(t, "alone"),
	)

	watching := km.Subscribe()
	km.BeginRun("watched", "cell-2", "2")
	km.publish(idle(t, "watched"))
	km.Unsubscribe(watching)

	require.Len(t, finished, 1)
	assert.Equal(t, "alone", finished[0].MsgID)
	assert.Equal(t, "x", finished[0].Outputs[0]["text"])
}

func TestAClientThatFallsBehindIsDropped(t *testing.T) {
	km := journalKernel()
	stalled := km.Subscribe()

	for i := 0; i <= subscriberBuffer; i++ {
		km.publish(iopub(t, "", "status", map[string]interface{}{"execution_state": "busy"}))
	}

	drained := 0
	for range stalled.Messages {
		drained++
	}
	assert.Equal(t, subscriberBuffer, drained, "the channel was closed once it was full")
	km.Unsubscribe(stalled)
}

func TestAStreamOutgrowingItsLimitKeepsItsEnd(t *testing.T) {
	km := journalKernel()
	km.BeginRun("m1", "cell-1", "log()")

	line := strings.Repeat("x", 1023) + "\n"
	for i := 0; i < maxStreamBytes/len(line)+10; i++ {
		km.publish(iopub(t, "m1", "stream", map[string]interface{}{"name": "stdout", "text": line}))
	}
	km.publish(iopub(t, "m1", "stream", map[string]interface{}{"name": "stdout", "text": "last\n"}))

	text := km.Subscribe().Replay.Runs[0].Outputs[0]["text"].(string)
	assert.LessOrEqual(t, len(text), maxStreamBytes)
	assert.True(t, strings.HasSuffix(text, "last\n"))
	assert.True(t, strings.HasPrefix(text, "x"), "cut at a line boundary")
}
