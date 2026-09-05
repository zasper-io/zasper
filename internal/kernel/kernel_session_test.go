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

	payload := session.Deserialize(zmq4.NewMsgFrom(frames...), "iopub")

	var read Message
	require.NoError(t, json.Unmarshal(payload, &read))
	require.NoError(t, read.Error, "the signature did not check out")
	return read
}

// published is a message on the wire as a kernel puts it there, signed with the session that sent it.
func published(session KernelSession, msg Message) zmq4.Msg {
	return zmq4.NewMsgFrom(session.serialize(msg)...)
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

	payload := session.Deserialize(zmq4.NewMsgFrom(tampered...), "shell")

	var read Message
	require.NoError(t, json.Unmarshal(payload, &read))
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

// How the activity watcher knows whether a kernel is busy, which is what /api/kernels reports for a
// kernel no window is attached to.
func TestOnlyAStatusMessageSaysWhatTheKernelIsDoing(t *testing.T) {
	session := getSession()

	status := session.MessageFromString("status")
	status.Content = map[string]interface{}{"execution_state": "busy"}
	assert.Equal(t, "busy", session.PublishedState(published(session, status)))

	// Every other kind is activity and nothing more, so the state last published stands.
	stream := session.MessageFromString("stream")
	stream.Content = map[string]interface{}{"text": "hello"}
	assert.Equal(t, "", session.PublishedState(published(session, stream)))

	// A status message whose content is some other shape says nothing rather than being read as
	// something: this is one field out of a message the rest of which is nobody's business here.
	odd := session.MessageFromString("status")
	odd.Content = "busy"
	assert.Equal(t, "", session.PublishedState(published(session, odd)))
}

// A message this session did not sign, which is not one to take a kernel's state from.
func TestAnUnsignedPublicationSaysNothing(t *testing.T) {
	session := getSession()
	other := getSession()

	status := other.MessageFromString("status")
	status.Content = map[string]interface{}{"execution_state": "busy"}

	assert.Equal(t, "", session.PublishedState(published(other, status)))
}

// Frames a kernel never sent: the walk for the delimiter runs off the end of anything shorter than a
// message, and reading a state out of one is worth less than not panicking.
func TestFramesThatAreNotAMessageSayNothing(t *testing.T) {
	session := getSession()

	assert.Equal(t, "", session.PublishedState(zmq4.NewMsgFrom()))
	assert.Equal(t, "", session.PublishedState(zmq4.NewMsgFrom([]byte("kernel.1.status"))))
	assert.Equal(t, "", session.PublishedState(zmq4.NewMsgFrom([]byte(DELIM), []byte("signature"))))
}

func TestEveryMessageCarriesTheProtocolVersion(t *testing.T) {
	session := getSession()

	read := roundTrip(t, session.MessageFromString("kernel_info_request"))

	// Empty is not a version: jupyter_client parses it with int() and refuses the message outright.
	assert.Equal(t, ProtocolVersion, read.Header.ProtocolVersion)
}
