package kernel

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"hash"
	"slices"

	"github.com/rs/zerolog/log"

	"github.com/go-zeromq/zmq4"
)

// ProtocolVersion goes in the header of every message this package builds. A kernel rejects a message
// whose version is empty — jupyter_client's adapter parses it with int() and raises — so this is a
// constant rather than something main() assigns: any binary that is not the server, a test binary
// above all, would otherwise send messages no kernel will answer.
const ProtocolVersion = "5.3"

type KernelSession struct {
	Key             string
	SignatureScheme string
}

func getSession() KernelSession {
	return KernelSession{Key: string(newIDBytes()), SignatureScheme: "hmac-sha256"}
}

func newAuth(key string) hash.Hash {
	return hmac.New(sha256.New, []byte(key))
}

func json_packer(obj interface{}) []byte {
	val, _ := json.Marshal(obj)
	return val
}

func (ks *KernelSession) SendStreamMsg(stream zmq4.Socket, msg Message) Message {
	if err := ks.send(stream, msg); err != nil {
		log.Error().Err(err).Msg("failed to send message")
	}
	return msg
}

// send signs msg and puts it on stream.
func (ks *KernelSession) send(stream zmq4.Socket, msg Message) error {
	return stream.SendMulti(zmq4.NewMsgFrom(ks.serialize(msg)...))
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
		json_packer(msg.ParentHeader),
		json_packer(msg.Metadata),
		json_packer(msg.Content),
	}
	to_send := [][]byte{}
	log.Debug().Msgf("real message is %s", realMessage)
	// Signed over those four frames only. Buffers are appended after the signature is taken, which is
	// what the protocol says and what a kernel checks.
	signature := ks.sign(realMessage)

	log.Debug().Msgf("signature is %s", signature)
	to_send = append(to_send, []byte(DELIM))
	to_send = append(to_send, []byte(signature))
	to_send = append(to_send, realMessage...)
	to_send = append(to_send, msg.Buffers...)
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

/*
PublishedState answers what a kernel has just said it is doing, and empty for a message that says nothing
about it: a `status` is the only kind that carries a state, and every other kind is activity and nothing
more.

Reads as little of the message as it takes to know, rather than going through Deserialize. This is on the
activity watcher's path — every message every running cell publishes — and Deserialize's work is the JSON
a browser is sent, which on that path there is nobody to send. jupyter_server's own watcher is careful in
the same place and the same way: the header first, and the content only for a status.
*/
func (ks *KernelSession) PublishedState(zmsg zmq4.Msg) string {
	signature, signed, _, ok := splitFrames(zmsg.Frames)
	if !ok {
		return ""
	}
	if !ks.signedBy(signature, signed) {
		log.Error().Msg("ignoring a published message that is not signed with this kernel's key")
		return ""
	}

	var header MessageHeader
	if err := json.Unmarshal(signed[0], &header); err != nil || header.MsgType != "status" {
		return ""
	}

	// Only the one field, so that a status message whose content is some other shape than expected says
	// nothing rather than being an error worth reporting.
	var content struct {
		ExecutionState string `json:"execution_state"`
	}
	if err := json.Unmarshal(signed[3], &content); err != nil {
		return ""
	}
	return content.ExecutionState
}

/*
Deserialize turns a kernel's message into the JSON a browser is sent. It answers nil for frames that
are not a whole message, are not signed with this kernel's key, or do not parse: nothing is forwarded
that the kernel did not send, and nothing a kernel sends can panic the poller reading it.
*/
func (ks *KernelSession) Deserialize(zmsg zmq4.Msg, channel string) []byte {
	signature, signed, buffers, ok := splitFrames(zmsg.Frames)
	if !ok {
		log.Warn().Str("channel", channel).Int("frames", len(zmsg.Frames)).Msg("ignoring frames that are not a kernel message")
		return nil
	}
	if !ks.signedBy(signature, signed) {
		log.Error().Str("channel", channel).Msg("ignoring a message that is not signed with this kernel's key")
		return nil
	}

	message := Message{Channel: channel}
	for part, into := range []interface{}{&message.Header, &message.ParentHeader, &message.Metadata, &message.Content} {
		if err := json.Unmarshal(signed[part], into); err != nil {
			log.Warn().Err(err).Str("channel", channel).Msg("ignoring a kernel message that is not valid JSON")
			return nil
		}
	}

	// Anything past the content is a binary buffer, and belongs to whoever asked for the message:
	// widget state names its buffers by position (`buffer_paths`), so they travel on and are not read
	// here.
	if len(buffers) > 0 {
		message.Buffers = buffers
	}

	jsonBytes, err := json.Marshal(message)
	if err != nil {
		log.Error().Msgf("Error marshaling message: %v", err)
		return nil
	}
	return jsonBytes
}

// splitFrames finds the message in the frames that carry it. Routing identities come first, in any
// number, so the delimiter is where it starts; ok is false for frames that are not a whole message.
func splitFrames(frames [][]byte) (signature []byte, signed [][]byte, buffers [][]byte, ok bool) {
	i := slices.IndexFunc(frames, func(frame []byte) bool { return string(frame) == DELIM })
	if i < 0 || len(frames) < i+6 {
		return nil, nil, nil, false
	}
	return frames[i+1], frames[i+2 : i+6], frames[i+6:], true
}

func (ks *KernelSession) signedBy(signature []byte, signed [][]byte) bool {
	return len(ks.Key) == 0 || hmac.Equal(signature, []byte(ks.sign(signed)))
}
