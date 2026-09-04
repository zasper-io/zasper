package kernel

import (
	"encoding/json"
	"testing"

	"github.com/go-zeromq/zmq4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// roundTrip sends a message the way a client's message reaches a kernel, and reads it back the way a
// kernel's message reaches the browser.
func roundTrip(t *testing.T, msg Message) Message {
	t.Helper()

	session := getSession()
	frames := session.serialize(msg)

	var read Message
	require.NoError(t, json.Unmarshal(session.Deserialize(zmq4.NewMsgFrom(frames...), "iopub"), &read))
	require.NoError(t, read.Error, "the signature did not check out")
	return read
}

// Binary buffers are how widget libraries send array data — bqplot puts every mark's x and y in one —
// and they are the frames after the content, which nothing used to read or write.
func TestBuffersSurviveTheTripToAKernelAndBack(t *testing.T) {
	session := getSession()
	msg := session.MessageFromString("comm_msg")
	msg.Buffers = [][]byte{{0x00, 0x01, 0xfe, 0xff}, {}, []byte("not utf-8 either: \xc3\x28")}

	read := roundTrip(t, msg)

	assert.Equal(t, msg.Buffers, read.Buffers)
}

func TestAMessageWithNoBuffersHasNone(t *testing.T) {
	session := getSession()

	read := roundTrip(t, session.MessageFromString("kernel_info_request"))

	assert.Empty(t, read.Buffers)
}

// The signature covers the header, parent header, metadata and content, and stops there. A kernel
// that signed the buffers too would reject every widget message.
func TestBuffersAreNotSigned(t *testing.T) {
	session := getSession()
	msg := session.MessageFromString("comm_msg")
	msg.Buffers = [][]byte{{0x01, 0x02}}

	frames := session.serialize(msg)
	tampered := append([][]byte{}, frames...)
	tampered[len(tampered)-1] = []byte{0x03, 0x04}

	var read Message
	require.NoError(t, json.Unmarshal(session.Deserialize(zmq4.NewMsgFrom(tampered...), "shell"), &read))
	assert.NoError(t, read.Error)
}

// A reply is addressed to the request that asked by its parent header, so sending the header as the
// parent — which serialize used to do — tells the kernel every message is its own parent.
func TestTheParentHeaderIsTheParentAndNotACopyOfTheHeader(t *testing.T) {
	session := getSession()
	msg := session.MessageFromString("input_reply")
	msg.ParentHeader = MessageHeader{MsgID: "the-request", MsgType: "input_request"}

	read := roundTrip(t, msg)

	assert.Equal(t, "the-request", read.ParentHeader.MsgID)
	assert.Equal(t, msg.Header.MsgID, read.Header.MsgID)
	assert.NotEqual(t, read.Header.MsgID, read.ParentHeader.MsgID)
}

func TestEveryMessageCarriesTheProtocolVersion(t *testing.T) {
	session := getSession()

	read := roundTrip(t, session.MessageFromString("kernel_info_request"))

	// Empty is not a version: jupyter_client parses it with int() and refuses the message outright.
	assert.Equal(t, ProtocolVersion, read.Header.ProtocolVersion)
}
