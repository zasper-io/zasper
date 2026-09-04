package kernel

import (
	"time"
)

type (
	MessageHeader struct {
		MsgID           string `json:"msg_id"`
		MsgType         string `json:"msg_type"`
		Username        string `json:"username"`
		Session         string `json:"session"`
		Date            string `json:"date"`
		ProtocolVersion string `json:"version"`
	}

	Message struct {
		Header       MessageHeader `json:"header"`
		ParentHeader MessageHeader `json:"parent_header"`
		MsgId        string        `json:"msg_id"`
		MsgType      string        `json:"msg_type"`
		Content      interface{}   `json:"content"`
		// The raw frames a message carries after its content: one per binary buffer, in order. Widget
		// libraries put array data in them (bqplot sends every mark's x and y this way), so dropping
		// them leaves a widget whose state arrived and whose data did not. Marshalled as an array of
		// base64 strings, which is what Go does with [][]byte and what the frontend decodes.
		Buffers  [][]byte    `json:"buffers"`
		Metadata interface{} `json:"metadata"`
		Tracker  int         `json:"tracker"`
		Error    error       `json:"error"`
		Channel  string      `json:"channel"`
	}
)

func (ks *KernelSession) newMsgHeader(msgType string, userName string) MessageHeader {
	return MessageHeader{
		MsgID:           newID(),
		MsgType:         msgType,
		Username:        userName,
		Session:         ks.Key,
		Date:            time.Now().UTC().Format(time.RFC3339),
		ProtocolVersion: ProtocolVersion,
	}
}

func (ks *KernelSession) createMsg(
	content interface{},
	parent MessageHeader,
	header MessageHeader,
	metadata map[string]interface{}) Message {

	msg := Message{}

	msg.MsgId = msg.Header.MsgID
	msg.ParentHeader = parent
	msg.Header = header
	msg.Content = content
	msg.Metadata = metadata
	return msg
}

func (ks *KernelSession) MessageFromString(value string) Message {
	msg := Message{}
	msg.Header = ks.newMsgHeader(value, GetUsername())
	msg.MsgId = msg.Header.MsgID
	msg.Content = make(map[string]interface{})
	msg.Metadata = make(map[string]interface{})
	msg.Buffers = [][]byte{}
	return msg
}

func (ks *KernelSession) MessageFromDict(value map[string]interface{}) Message {
	return Message{}
}
