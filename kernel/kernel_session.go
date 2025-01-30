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
	var ident [][]byte
	if ks.CheckPid && os.Getpid() != ks.Pid {
		log.Info().Msgf("WARNING: attempted to send message from fork %+v", msg)
	}
	toSend := ks.serialize(msg, ident)
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
	ident [][]byte,
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
		msg = ks.createMsg(v, content, parent, header, metadata)
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

	toSend := ks.serialize(msg, ident)

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

func (ks *KernelSession) serialize(msg Message, ident [][]byte) [][]byte {
	DELIM := "<IDS|MSG>"
	log.Info().Msgf("message header is %v", msg.Header)

	realMessage := [][]byte{
		json_packer(msg.Header),
		json_packer(msg.Header),
		json_packer(msg.Metadata),
		json_packer(msg.Content), // []byte("kernel_info_request"),
	}
	to_send := [][]byte{}
	log.Debug().Msgf("real message is %s", realMessage)
	signature := ks.sign(realMessage)
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

	log.Debug().Msgf("Message: %+v\n", message)

	return message, nil
}
