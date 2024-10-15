package kernel

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"os"

	"github.com/rs/zerolog/log"

	"github.com/pebbe/zmq4"
)

var ProtocolVersion string

type KernelSession struct {
	Key             string
	Pid             int
	Auth            hash.Hash
	SignatureScheme string
	CheckPid        bool
	Packer          string
	Unpacker        string
	AdaptVersion    string
	Debug           bool
	CopyThreshold   int
	session         string
	messageCount    int
}

func getSession() KernelSession {
	session := KernelSession{}
	session.setKey(string(newIDBytes()))
	session.SignatureScheme = "hmac-sha256"
	return session
}

func (ks *KernelSession) setKey(value string) {
	ks.Key = value
	ks.Auth = newAuth(value)
}

func (ks *KernelSession) Unpack(data []interface{}) interface{} {
	// Implement the unpack logic
	data2 := "abc"
	return data2
}

func newAuth(key string) hash.Hash {
	return hmac.New(sha256.New, []byte(key))
}

func json_packer(obj interface{}) []byte {
	val, _ := json.Marshal(obj)
	return val
}

func (ks *KernelSession) SendStreamMsg(stream *zmq4.Socket, msg interface{}) {
	var content map[string]interface{}
	var ident [][]byte
	var parent MessageHeader
	var buffers []byte
	track := true
	var header MessageHeader
	var metadata map[string]interface{}
	ks.Send(stream, msg, content, parent, ident, buffers, track, header, metadata)
}

func (ks *KernelSession) Send(
	stream *zmq4.Socket,
	msgOrType interface{},
	content interface{},
	parent MessageHeader,
	ident [][]byte,
	buffers []byte,
	track bool,
	header MessageHeader,
	metadata map[string]interface{},
) Message {

	log.Info().Msg("================sending the message===============")

	var msg Message
	switch v := msgOrType.(type) {
	case Message:
		// log.Print("received Message type")
		msg = v
		if buffers == nil {
			// fill the buffer with msg buffers
			buffers = msg.Buffers
		}
	case string:
		// kernel info request goes
		// log.Print("received String type")
		msg = ks.createMsg(v, content, parent, header, metadata)
	default:
		log.Info().Msgf("msg_or_type must be of type Message or string, got %T", v)
	}

	log.Info().Msgf("message is %+v", msg)

	if ks.CheckPid && os.Getpid() != ks.Pid {
		log.Info().Msgf("WARNING: attempted to send message from fork %+v", msg)
		return Message{}
	}

	if buffers == nil {
		buffers = []byte{}
	}

	// for idx, buf := range buffers {
	// 	if len(buf) == 0 {
	// 		log.Fatal().Msgf("Buffer %d is empty", idx)
	// 	}
	// }

	if ks.AdaptVersion != "" {
		// msg = adapt(msg, s.adaptVersion)
	}

	toSend := ks.serialize(msg, ident)
	// log.Info().Msgf("to send message is %s", toSend)

	// toSend = append(toSend, buffers...)

	// longest := 0
	// for _, s := range toSend {
	// 	if len(s) > longest {
	// 		longest = len(s)
	// 	}
	// }

	// copy := longest < ks.CopyThreshold

	var tracker int
	// if len(buffers) > 0 && track && !copy {
	// 	// Track message if we are doing zero-copy buffers
	// 	// This part needs proper implementation for actual tracking
	// 	tracker, _ = stream.SendBytes(toSend, zmq4.DONTWAIT)
	// } else {
	// 	// Use dummy tracker, which will be done immediately
	// 	stream.SendBytes(toSend, zmq4.DONTWAIT)
	// }
	tracker, _ = stream.SendMessage(toSend)

	if ks.Debug {
		log.Info().Msgf("Message: %s\n", msg.MsgId)
		log.Info().Msgf("ToSend: %s\n", toSend)
		log.Info().Msgf("Buffers: %s\n", buffers)
	}

	msg.Tracker = tracker

	// log.Info().Msgf("The message sent to kernel is %s", toSend)
	// log.Printf("%+v\n", msg)

	return msg
}

func (ks *KernelSession) serialize(msg Message, ident [][]byte) [][]byte {
	DELIM := "<IDS|MSG>"
	content := msg.Content
	// log.Println(content)
	switch content.(type) {
	case string:
		log.Info().Msgf("content %s", content)
	}
	realMessage := [][]byte{
		json_packer(msg.Header),
		json_packer("{}"),
		json_packer(msg.Metadata),
		[]byte("{}"), // []byte("kernel_info_request"),
	}
	to_send := [][]byte{}
	// log.Info().Msgf("real message is %s", realMessage)
	signature := ks.sign(realMessage)
	to_send = append(to_send, []byte(DELIM))
	to_send = append(to_send, []byte(signature))
	to_send = append(to_send, realMessage...)
	// log.Info().Msgf("after signing message is %s", realMessage)
	return to_send
}

func (ks *KernelSession) sign(msg_list [][]byte) string {
	hash := newAuth(ks.Key)
	for _, msg := range msg_list {
		hash.Write(msg)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

// Deserialize function
func (ks *KernelSession) deserialize(
	msgList [][]byte, // List of byte slices
	content bool,
	copy bool,
	authKey []byte,
	digestHistory map[string]struct{}, // Keep track of used signatures
) (Message, error) {
	minLen := 5
	var message Message

	// Handle signature verification if authKey is provided
	if authKey != nil {
		signature := msgList[0]
		if len(signature) == 0 {
			return message, errors.New("unsigned message")
		}
		if _, found := digestHistory[string(signature)]; found {
			return message, errors.New("duplicate signature")
		}

		// Calculate expected signature
		check := ks.sign(msgList[1:5])
		if !hmac.Equal(signature, []byte(check)) {
			return message, fmt.Errorf("invalid signature: %x", signature)
		}

		// Add signature to digest history
		digestHistory[string(signature)] = struct{}{}
	}

	if len(msgList) < minLen {
		return message, fmt.Errorf("malformed message, must have at least %d elements", minLen)
	}

	// Unmarshal JSON from the message parts
	if err := json.Unmarshal(msgList[1], &message.Header); err != nil {
		return message, fmt.Errorf("error unmarshalling header: %w", err)
	}
	message.MsgId = message.Header.MsgID
	message.MsgType = message.Header.MsgType

	if err := json.Unmarshal(msgList[2], &message.ParentHeader); err != nil {
		return message, fmt.Errorf("error unmarshalling parent header: %w", err)
	}

	if err := json.Unmarshal(msgList[3], &message.Metadata); err != nil {
		return message, fmt.Errorf("error unmarshalling metadata: %w", err)
	}

	if content {
		if err := json.Unmarshal(msgList[4], &message.Content); err != nil {
			return message, fmt.Errorf("error unmarshalling content: %w", err)
		}
	} else {
		message.Content = msgList[4]
	}

	// Handle buffers
	// message.Buffers = msgList[5:]

	// Debug print
	fmt.Printf("Message: %+v\n", message)

	// Adapt to the current version (implement as needed)
	// message = adapt(message)

	return message, nil
}
