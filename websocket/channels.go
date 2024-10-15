package websocket

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"time"
	"zasper_go/kernel"

	"github.com/rs/zerolog/log"

	"github.com/pebbe/zmq4"
	"golang.org/x/exp/rand"
)

const DELIM = "<IDS|MSG>"

type KernelWebSocketConnection struct {
	KernelManager        kernel.KernelManager
	LimitRate            bool
	IOpubMsgRateLimit    int
	IOpubDataRateLimit   int
	RateLimitWindow      int
	Context              context.Context
	OpenSessions         []string
	OpenSockets          []string
	Channels             map[string]*zmq4.Socket
	Session              kernel.KernelSession
	IOPubWindowMsgCount  int
	IOPubWindowByteCount int
	IOPubMsgsExceeded    int
	IOPubDataExceeded    int
	IOPubWindowByteQueue []interface{}
	KernelInfoChannel    zmq4.Socket
	Subprotocol          string
}

func (kwsConn *KernelWebSocketConnection) getAllowedMessageTypes() []string {
	return make([]string, 0)
}

func (kwsConn *KernelWebSocketConnection) prepare(sessionId string) {
	registerWebSocketSession(sessionId)
	km := kwsConn.KernelManager
	if km.Ready {
		log.Info().Msg("===========Kernel is ready=============")
		log.Info().Msgf("%s", km.Session.Key)
	} else {
		log.Info().Msg("===========Kernel is not ready============")
	}
	// raise timeout error
	kwsConn.Session = km.Session

	//request_kernel_info -> connect shell socket
}

func (kwsConn *KernelWebSocketConnection) connect() {
	log.Info().Msg("notifying connection")
	kernel.NotifyConnect()

	log.Info().Msg("creating stream")
	kwsConn.createStream()

	log.Info().Msg("Nudging the kernel")
	kwsConn.nudge()
}

func (kwsConn *KernelWebSocketConnection) createStream() {

	// connect on iopub, shell, control, stdin
	// not sure about hb

	cinfo := kwsConn.KernelManager.ConnectionInfo
	kwsConn.Channels["iopub"] = connect_iopub(cinfo)
	// kwsConn.Channels["shell"] = connect_shell(cinfo)
	// kwsConn.Channels["control"] = connect_control(cinfo)
	kwsConn.Channels["stdin"] = connect_stdin(cinfo)
	kwsConn.Channels["hb"] = connect_hb(cinfo)
}

// cst["hb"] = zmq4.Req
// "hb_port": 4283,
func (kwsConn *KernelWebSocketConnection) nudge() {

	/*
		Nudge the zmq connections with kernel_info_requests
		Returns a Future that will resolve when we have received
		a shell or control reply and at least one iopub message,
		ensuring that zmq subscriptions are established,
		sockets are fully connected, and kernel is responsive.
		Keeps retrying kernel_info_request until these are both received.
	*/
	transient_shell_channel := connectShell(kwsConn.KernelManager.ConnectionInfo)
	transient_control_channel := connectControl(kwsConn.KernelManager.ConnectionInfo)
	// shell returns info future
	// Create a Poller
	poller := zmq4.NewPoller()
	poller.Add(transient_shell_channel, zmq4.POLLIN)
	poller.Add(transient_control_channel, zmq4.POLLIN)

	kwsConn.Session.SendStreamMsg(transient_control_channel, "kernel_info_request")
	kwsConn.Session.SendStreamMsg(transient_shell_channel, "kernel_info_request")

	for {
		// Poll the sockets with a timeout of 1 second
		sockets, err := poller.Poll(1 * time.Second)
		if err != nil {
			log.Info().Msgf("%s", err)
		}

		// Check which sockets have events
		for _, socket := range sockets {
			switch s := socket.Socket; s {
			case transient_shell_channel:
				msg, _ := s.Recv(0)
				fmt.Printf("Received from Shell socket: %s\n", msg)

			case transient_control_channel:
				msg, _ := s.Recv(0)
				fmt.Printf("Received from Control socket: %s\n", msg)
			}
		}
	}

}

func deserializeMsgFromWsV1([]byte) (string, []interface{}) {
	return "msg", make([]interface{}, 0)
}

func (kwsConn *KernelWebSocketConnection) handleIncomingMessage(messageType int, incomingMsg []byte) {
	// msg, _ := deserializeBinaryMessage(ws_msg)
	// log.Info().Msgf("%s", msg)

	wsMsg := incomingMsg
	// h.mu.Lock()
	// defer h.mu.Unlock()

	if len(kwsConn.Channels) == 0 {
		log.Printf("Received message on closed websocket: %v", wsMsg)
		return
	}

	var msg Message
	// var msgList []interface{}
	// msgList = make([]interface{}, 0)
	var channel string

	if kwsConn.Subprotocol == "v1.kernel.websocket.jupyter.org" {
		// channel, msgList = deserializeMsgFromWsV1(wsMsg)
		msg = Message{
			Header: nil,
		}
	} else {
		// if isBinary(wsMsg) { // Implement your binary check
		// 	msg = deserializeBinaryMessage([]byte(wsMsg))
		// } else {
		if err := json.Unmarshal([]byte(wsMsg), &msg); err != nil {
			log.Info().Msgf("Error unmarshalling message: %s", err)
			return
		}

		// msgList = []interface{}{}
		channel = msg.Header["channel"].(string)
		delete(msg.Header, "channel")
	}

	if channel == "" {
		log.Printf("No channel specified, assuming shell: %v", msg)
		channel = "shell"
	}

	if _, ok := kwsConn.Channels[channel]; !ok {
		log.Printf("No such channel: %v", channel)
		return
	}

	allowedMsgTypes := kwsConn.getAllowedMessageTypes()
	ignoreMsg := false

	if len(allowedMsgTypes) > 0 {
		// msg.Header = kwsConn.GetPart("header", msg.Header, msgList)
		if msg.Header == nil {
			log.Info().Msg("Header is nil")
			return
		}
		// if !contains(allowedMsgTypes, msg.Header["msg_type"].(string)) {
		// 	log.Printf("Received message of type \"%s\", which is not allowed. Ignoring.", msg.Header["msg_type"])
		// 	ignoreMsg = true
		// }
	}

	if !ignoreMsg {
		stream := kwsConn.Channels[channel]
		fmt.Print(stream)
		if kwsConn.Subprotocol == "v1.kernel.websocket.jupyter.org" {
			// kwsConn.Session.SendRaw(stream, msgList)
		} else {
			// kwsConn.Session.Send(stream, msg)
		}
	}
}

func (kwsConn *KernelWebSocketConnection) GetPart(field string, value map[string]interface{}, msgList []interface{}) interface{} {
	// Check if the value is nil
	if value == nil {
		field2idx := map[string]int{
			"header":        0,
			"parent_header": 1,
			"content":       3,
		}
		if idx, ok := field2idx[field]; ok && idx < len(msgList) {
			// value = kwsConn.Session.Unpack(msgList[idx])
		}
	}
	return value
}

func feedIdentities(msgList interface{}, copy bool) ([][]byte, interface{}, error) {

	var idents [][]byte
	var remaining interface{}

	if copy {
		bytesList, ok := msgList.([][]byte)
		if !ok {
			return nil, nil, errors.New("msgList should be a list of bytes")
		}

		for i, msg := range bytesList {
			if string(msg) == DELIM { // Assuming DELIM is a byte
				idents = bytesList[:i]
				remaining = bytesList[i+1:]
				return idents, remaining, nil
			}
		}
	} else {
		msgListPtr, ok := msgList.([]*Message)
		if !ok {
			return nil, nil, errors.New("msgList should be a list of Message")
		}
		fmt.Println(msgListPtr)

		// for i, msg := range msgListPtr {
		// 	if msg0[] == DELIM { // Assuming DELIM is a byte
		// 		idents = make([][]byte, i)
		// 		for j := 0; j < i; j++ {
		// 			idents[j] = msgListPtr[j].Bytes
		// 		}
		// 		remaining = msgListPtr[i+1:]
		// 		return idents, remaining, nil
		// 	}
		// }
	}

	return nil, nil, errors.New("DELIM not in msgList")
}

func (kwsConn *KernelWebSocketConnection) handleOutgoingMessage(stream string, outgoing_msg [](interface{})) {
	msg_list := outgoing_msg
	fmt.Println(msg_list)
}

type Msg struct {
	Header       string
	ParentHeader string
	Buffers      string
}

// Parses an ISO8601 date string and returns a time.Time object if successful.
func parseDate(dateStr string) (time.Time, error) {
	layout := time.RFC3339 // Adjust if needed for different ISO8601 formats.
	parsedTime, err := time.Parse(layout, dateStr)
	if err != nil {
		return time.Time{}, err
	}
	return parsedTime, nil
}

// Recursively processes the input to extract and parse ISO8601 date strings.
func extractDates(obj interface{}) interface{} {
	switch v := obj.(type) {
	case map[string]interface{}:
		newObj := make(map[string]interface{})
		for k, value := range v {
			newObj[k] = extractDates(value)
		}
		return newObj
	case []interface{}:
		newSlice := make([]interface{}, len(v))
		for i, value := range v {
			newSlice[i] = extractDates(value)
		}
		return newSlice
	case string:
		if t, err := parseDate(v); err == nil {
			return t
		}
		return v
	default:
		return obj
	}
}

// Deserialize the binary message.
func deserializeBinaryMessage(bmsg []byte) (map[string]interface{}, error) {
	if len(bmsg) < 4 {
		return nil, fmt.Errorf("binary message too short")
	}

	// Read the number of buffers.
	nbufs := int(binary.BigEndian.Uint32(bmsg[:4]))

	if len(bmsg) < 4*(nbufs+1) {
		return nil, fmt.Errorf("binary message too short for offsets")
	}

	// Read the offsets.
	offsets := make([]uint32, nbufs)
	offsetBuffer := bmsg[4 : 4*(nbufs+1)]
	for i := 0; i < nbufs; i++ {
		offsets[i] = binary.BigEndian.Uint32(offsetBuffer[i*4 : (i+1)*4])
	}

	// Append the end of the buffer.
	offsets = append(offsets, uint32(len(bmsg)))

	// Extract the buffers.
	bufs := make([][]byte, nbufs+1)
	for i := 0; i < len(offsets)-1; i++ {
		start := offsets[i]
		stop := offsets[i+1]
		bufs[i] = bmsg[start:stop]
	}

	// Unmarshal the JSON message from the first buffer.
	var msg map[string]interface{}
	if err := json.Unmarshal(bufs[0], &msg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON: %v", err)
	}

	// Process the headers and buffers.
	if header, ok := msg["header"].(map[string]interface{}); ok {
		msg["header"] = extractDates(header)
	}
	if parentHeader, ok := msg["parent_header"].(map[string]interface{}); ok {
		msg["parent_header"] = extractDates(parentHeader)
	}
	msg["buffers"] = bufs[1:]

	return msg, nil
}

func registerWebSocketSession(sessionId string) {
	log.Info().Msgf("registering a new session: %s", sessionId)
}

func makeURL(channel string, port int) string {
	ip := "127.0.0.1"
	Transport := "tcp"
	if Transport == "tcp" {
		return fmt.Sprintf("tcp://%s:%d", ip, port)
	}
	return fmt.Sprintf("%s://%s-%d", Transport, ip, port)
}

func connectShell(cinfo kernel.Connection) *zmq4.Socket {
	channel := "shell"
	url := makeURL(channel, cinfo.ShellPort)

	socket, _ := zmq4.NewSocket(zmq4.DEALER)
	// set_id(socket)
	socket.Connect(url)
	return socket

}

func connectControl(cinfo kernel.Connection) *zmq4.Socket {
	channel := "control"
	url := makeURL(channel, cinfo.ControlPort)

	socket, _ := zmq4.NewSocket(zmq4.DEALER)
	socket.Connect(url)
	return socket
}

func set_id(soc *zmq4.Socket) {
	identity := fmt.Sprintf("%04X-%04X", rand.Intn(0x10000), rand.Intn(0x10000))
	soc.SetIdentity(identity)
}

func connect_iopub(cinfo kernel.Connection) *zmq4.Socket {
	channel := "iopub"
	url := makeURL(channel, cinfo.IopubPort)

	socket, _ := zmq4.NewSocket(zmq4.SUB)
	// srt subscription filter
	socket.SetSubscribe("")
	socket.Connect(url)

	return socket

}

func connect_stdin(cinfo kernel.Connection) *zmq4.Socket {
	channel := "stdin"
	url := makeURL(channel, cinfo.StdinPort)
	fmt.Println(url)
	socket, _ := zmq4.NewSocket(zmq4.DEALER)
	socket.Connect(url)
	return socket

}

func connect_hb(cinfo kernel.Connection) *zmq4.Socket {
	channel := "hb"
	url := makeURL(channel, cinfo.HbPort)
	socket, _ := zmq4.NewSocket(zmq4.REQ)
	socket.Connect(url)
	return socket

}

// Define a callback type
type MessageCallback func(string)

// Function to handle incoming messages and call the callback
func listenForMessages(socket *zmq4.Socket, callback MessageCallback) {
	// Wait for the listener to be ready (simulate with a delay)
	fmt.Println("Waiting for socket to start...")
	time.Sleep(10 * time.Second) // Adjust this based on your needs
	for {
		msg, err := socket.Recv(0)
		if err != nil {
			log.Info().Msgf("Error receiving message: %s", err)
			continue
		}
		callback(msg)
	}
}

// Define the structure of the message
type Message struct {
	Header       map[string]interface{} `json:"header"`
	MsgID        string                 `json:"msg_id"`
	MsgType      string                 `json:"msg_type"`
	ParentHeader map[string]interface{} `json:"parent_header"`
	Metadata     map[string]interface{} `json:"metadata"`
	Content      interface{}            `json:"content"`
	Buffers      [][]byte               `json:"buffers"`
}

// Function to sign the message parts
func sign(parts [][]byte, key []byte) []byte {
	h := hmac.New(sha256.New, key)
	for _, part := range parts {
		h.Write(part)
	}
	return h.Sum(nil)
}
