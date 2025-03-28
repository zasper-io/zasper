package kernel

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"os"

	"github.com/rs/zerolog/log"

	"github.com/go-zeromq/zmq4"
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

func newAuth(key string) hash.Hash {
	return hmac.New(sha256.New, []byte(key))
}

func json_packer(obj interface{}) []byte {
	val, _ := json.Marshal(obj)
	return val
}

func (ks *KernelSession) SendStreamMsg(stream zmq4.Socket, msg Message) Message {
	if ks.CheckPid && os.Getpid() != ks.Pid {
		log.Info().Msgf("WARNING: attempted to send message from fork %+v", msg)
	}
	toSend := ks.serialize(msg)
	// var tracker error
	err := stream.SendMulti(zmq4.NewMsgFrom(toSend...))
	if err != nil {
		log.Error().Err(err).Msg("failed to send message")
	}
	msg.Tracker = 0 // Set to default value since we're not tracking
	return msg
}

// [
//	b"u-u-i-d",  # zmq identity(ies)
//	b"<IDS|MSG>",  # delimiter
//	b"baddad42",  # HMAC signature
//	b"{header}",  # serialized header dict
//	b"{parent_header}",  # serialized parent header dict
//	b"{metadata}",  # serialized metadata dict
//	b"{content}",  # serialized content dict
//	b"\xf0\x9f\x90\xb1"  # extra raw data buffer(s)
//	# ...
// ]

func (ks *KernelSession) Send(
	stream zmq4.Socket,
	msgOrType interface{},
	content interface{},
	parent MessageHeader,
	buffers []byte,
	track bool,
	header MessageHeader,
	metadata map[string]interface{},
) Message {

	var msg Message
	switch v := msgOrType.(type) {
	case Message:
		msg = v
		if buffers == nil {
			buffers = msg.Buffers
		}
	case string:
		msg = ks.createMsg(content, parent, header, metadata)
	default:
		log.Debug().Msgf("msg_or_type must be of type Message or string, got %T", v)
	}

	log.Debug().Msgf("message is %+v", msg)

	if buffers == nil {
		buffers = []byte{}
	}

	if ks.AdaptVersion != "" {
		// msg = adapt(msg, s.adaptVersion)
	}

	toSend := ks.serialize(msg)

	err := stream.SendMulti(zmq4.NewMsgFrom(toSend...))

	if err != nil {
		log.Error().Err(err).Msg("failed to send message")
	}
	msg.Tracker = 0 // Set to default value since we're not tracking

	if ks.Debug {
		log.Debug().Msgf("Message: %s\n", msg.MsgId)
		log.Debug().Msgf("ToSend: %s\n", toSend)
		log.Debug().Msgf("Buffers: %s\n", buffers)
	}

	return msg
}

// parts[0] = key
// parts[1] = header
// parts[2] = parentHeader
// parts[3] = metadata
// parts[4] = content

func (ks *KernelSession) serialize(msg Message) [][]byte {
	DELIM := "<IDS|MSG>"
	log.Debug().Msgf("message header is %v", msg.Header)

	realMessage := [][]byte{
		json_packer(msg.Header),
		json_packer(msg.Header),
		json_packer(msg.Metadata),
		json_packer(msg.Content),
	}
	to_send := [][]byte{}
	log.Debug().Msgf("real message is %s", realMessage)
	signature := ks.sign(realMessage)

	log.Debug().Msgf("signature is %s", signature)
	to_send = append(to_send, []byte(DELIM))
	to_send = append(to_send, []byte(signature))
	to_send = append(to_send, realMessage...)
	log.Debug().Msgf("after signing message is %s", realMessage)
	return to_send
}

func (ks *KernelSession) sign(msg_list [][]byte) string {
	hash := newAuth(ks.Key)
	for _, msg := range msg_list {
		hash.Write(msg)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func (ks *KernelSession) Deserialize(zmsg zmq4.Msg, chanel string) []byte {

	msg := zmsg.Bytes()
	log.Debug().Msgf("Received from IoPub socket: %s\n", msg)

	frames := zmsg.Frames

	kernelResponseMsg := Message{}

	i := 0

	for string(frames[i]) != "<IDS|MSG>" {
		i++
	}

	// Validate signature.
	if len(ks.Key) != 0 {
		mac := hmac.New(sha256.New, []byte(ks.Key))
		for _, frame := range frames[i+2 : i+6] {
			mac.Write(frame)
		}
		signature := make([]byte, hex.DecodedLen(len(frames[i+1])))
		_, err := hex.Decode(signature, frames[i+1])
		if err != nil {
			kernelResponseMsg.Error = fmt.Errorf("invalid signature: while decoding message")
			jsonBytes, _ := json.Marshal(kernelResponseMsg)
			return jsonBytes
		}
		if !hmac.Equal(mac.Sum(nil), signature) {
			kernelResponseMsg.Error = fmt.Errorf("invalid signature: while comparing message")
			jsonBytes, _ := json.Marshal(kernelResponseMsg)
			return jsonBytes
		}
	}

	// Unmarshal contents.
	var err error
	err = json.Unmarshal(frames[i+2], &kernelResponseMsg.Header)
	if err != nil {
		kernelResponseMsg.Error = fmt.Errorf("error unmarshalling Header: %w", err)
	}
	err = json.Unmarshal(frames[i+3], &kernelResponseMsg.ParentHeader)
	if err != nil {
		kernelResponseMsg.Error = fmt.Errorf("error unmarshalling ParentHeader: %w", err)

	}
	err = json.Unmarshal(frames[i+4], &kernelResponseMsg.Metadata)
	if err != nil {
		kernelResponseMsg.Error = fmt.Errorf("error unmarshalling Metadata: %w", err)
	}
	err = json.Unmarshal(frames[i+5], &kernelResponseMsg.Content)
	if err != nil {
		kernelResponseMsg.Error = fmt.Errorf("error unmarshalling Content: %w", err)
	}

	kernelResponseMsg.Channel = chanel

	jsonBytes, err := json.Marshal(kernelResponseMsg)
	if err != nil {
		log.Error().Msgf("Error marshaling message: %v", err)
		return nil
	}
	return jsonBytes

}
