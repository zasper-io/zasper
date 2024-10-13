package kernel

import (
	"time"

	"github.com/rs/zerolog/log"
)

type MessageHeader struct {
	MsgID    string    `json:"msg_id"`
	MsgType  string    `json:"msg_type"`
	Username string    `json:"username"`
	Session  string    `json:"session"`
	Date     time.Time `json:"date"`
	Version  string    `json:"version"`
}

func (ks *KernelSession) newMsgHeader(msgType string, userName string, session string) MessageHeader {
	return MessageHeader{
		MsgID:    newID(),
		MsgType:  msgType,
		Username: userName,
		Session:  ks.Key,
		Date:     time.Now().UTC(),
		Version:  ProtocolVersion,
	}
}

type Message struct {
	Header       MessageHeader `json:"header"`
	ParentHeader MessageHeader `json:"parent_header"`
	MsgId        string        `json:"msg_id"`
	MsgType      string        `json:"msg_type"`
	Content      interface{}   `json:"content"`
	Buffers      []byte        `json:"buffers"`
	Metadata     string        `json:"metadata"`
	Tracker      int           `json:"tracker"`
}

func (ks *KernelSession) createMsg(msgType string,
	content interface{},
	parent MessageHeader,
	header MessageHeader,
	metadata map[string]interface{}) Message {

	msg := Message{}
	// expect header is not provided
	if header == (MessageHeader{}) {
		// log.Println("new header created")
		msg.Header = ks.newMsgHeader(msgType, getUsername(), ks.Key)
	} else {
		// log.Println("new header is NOT created")
		msg.Header = header
	}

	// log.Println(nheader)

	msg.MsgId = msg.Header.MsgID
	// msg.ParentHeader = parent
	msg.Content = "{}"
	msg.Metadata = "{}"
	log.Info().Msgf("new message is %s", msg)
	return msg
}
