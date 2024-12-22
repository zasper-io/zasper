package websocket

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/kernel"

	"github.com/pebbe/zmq4"
)

const DELIM = "<IDS|MSG>"

type KernelWebSocketConnection struct {
	Conn                 *websocket.Conn
	Send                 chan []byte
	KernelId             string
	KernelManager        kernel.KernelManager
	LimitRate            bool
	IOpubMsgRateLimit    int
	IOpubDataRateLimit   int
	RateLimitWindow      int
	Context              context.Context
	OpenSessions         map[string]kernel.KernelSession
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
	mu                   sync.Mutex
}

func (kwsConn *KernelWebSocketConnection) getAllowedMessageTypes() []string {
	return make([]string, 0)
}

// IsJSON checks if the given byte slice is valid JSON
func IsJSON(data []byte) bool {
	var js json.RawMessage
	return json.Unmarshal(data, &js) == nil
}

func (kwsConn *KernelWebSocketConnection) writeMessage() { //msg interface{}, binary bool
	iopub_channel := kwsConn.Channels["iopub"]
	shell_channel := kwsConn.Channels["shell"]

	poller := zmq4.NewPoller()
	poller.Add(iopub_channel, zmq4.POLLIN)
	poller.Add(shell_channel, zmq4.POLLIN)

	// Create a variable to accumulate JSON data
	var jsonResponse map[string]interface{}
	jsonResponse = make(map[string]interface{})

	var jsonResponseShell map[string]interface{}
	jsonResponseShell = make(map[string]interface{})

	for {
		// Poll the sockets with a timeout of 1 second
		sockets, err := poller.Poll(1 * time.Second)
		if err != nil {
			log.Info().Msgf("%s", err)
		}

		for _, socket := range sockets {
			if socket.Socket == nil {
				continue
			}
			switch s := socket.Socket; s {

			case iopub_channel:
				msg, _ := s.Recv(0)
				log.Info().Msgf("Received from IoPub socket: %s\n", msg)
				if IsJSON([]byte(msg)) {
					var msgData map[string]interface{}
					err := json.Unmarshal([]byte(msg), &msgData)
					if err != nil {
						log.Info().Msgf("Error unmarshaling JSON message: %s", err)
						continue
					}

					for key, value := range msgData {
						jsonResponse[key] = value
					}

					if _, ok := jsonResponse["execution_state"]; ok {
						jsonResponse["channel"] = "iopub"
						jsonData, err := json.Marshal(jsonResponse)
						if err != nil {
							log.Info().Msgf("Error marshaling JSON: %s", err)
							continue
						}
						kwsConn.Send <- []byte(jsonData)
						jsonResponse = make(map[string]interface{})
					}

				} else {
					if len(jsonResponse) > 0 {
						jsonResponse["channel"] = "iopub"
						jsonData, err := json.Marshal(jsonResponse)
						if err != nil {
							log.Info().Msgf("Error marshaling JSON: %s", err)
							continue
						}
						kwsConn.Send <- []byte(jsonData)
						jsonResponse = make(map[string]interface{})
					}

				}
			case shell_channel:
				msg, _ := s.Recv(0)
				if IsJSON([]byte(msg)) {
					var msgData map[string]interface{}
					err := json.Unmarshal([]byte(msg), &msgData)
					if err != nil {
						log.Info().Msgf("Error unmarshaling JSON message: %s", err)
						continue
					}

					for key, value := range msgData {
						jsonResponseShell[key] = value
					}

				} else {
					if len(jsonResponse) > 0 {
						jsonResponse["channel"] = "shell"
						jsonData, err := json.Marshal(jsonResponse)
						if err != nil {
							log.Info().Msgf("Error marshaling JSON: %s", err)
							continue
						}
						kwsConn.Send <- []byte(jsonData)
						jsonResponseShell = make(map[string]interface{})
					}

				}

			}
		}

	}
}

func (kwsConn *KernelWebSocketConnection) prepare(sessionId string) {
	registerWebSocketSession(sessionId)
	km := kwsConn.KernelManager
	if km.Ready {
		log.Info().Msgf("%s", km.Session.Key)
	} else {
		log.Info().Msg("Kernel is not ready")
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

	// subscribe
	go kwsConn.writeMessage()
	// add connection to registry

}

func (kwsConn *KernelWebSocketConnection) createStream() {

	// connect on iopub, shell, control, stdin
	// not sure about hb

	cinfo := kwsConn.KernelManager.ConnectionInfo
	kwsConn.Channels["iopub"] = cinfo.ConnectIopub()
	kwsConn.Channels["shell"] = cinfo.ConnectShell()
	kwsConn.Channels["control"] = cinfo.ConnectControl()
	kwsConn.Channels["stdin"] = cinfo.ConnectStdin()
	kwsConn.Channels["hb"] = cinfo.ConnectHb()
}

func (kwsConn *KernelWebSocketConnection) nudge() {

	/*
		Nudge the zmq connections with kernel_info_requests
		Returns a Future that will resolve when we have received
		a shell or control reply and at least one iopub message,
		ensuring that zmq subscriptions are established,
		sockets are fully connected, and kernel is responsive.
		Keeps retrying kernel_info_request until these are both received.
	*/

	kernelInfoRequest := kwsConn.Session.MessageFromString("kernel_info_request")
	kernelInfoRequest2 := kwsConn.Session.MessageFromString("kernel_info_request")

	transient_shell_channel := kwsConn.KernelManager.ConnectionInfo.ConnectShell()
	transient_control_channel := kwsConn.KernelManager.ConnectionInfo.ConnectControl()

	iopub_channel := kwsConn.Channels["iopub"]
	// shell returns info future
	// Create a Poller
	poller := zmq4.NewPoller()
	poller.Add(transient_shell_channel, zmq4.POLLIN)
	poller.Add(transient_control_channel, zmq4.POLLIN)
	poller.Add(iopub_channel, zmq4.POLLIN)

	kwsConn.Session.SendStreamMsg(transient_control_channel, kernelInfoRequest)
	kwsConn.Session.SendStreamMsg(transient_shell_channel, kernelInfoRequest2)

	infoFuture := false
	shellFuture := false
	controlFuture := false

	for {
		if infoFuture && shellFuture && controlFuture {
			break
		}
		// Poll the sockets with a timeout of 1 second
		sockets, err := poller.Poll(3 * time.Second)
		if err != nil {
			log.Info().Msgf("%s", err)
		}

		// Check which sockets have events
		for _, socket := range sockets {
			if socket.Socket == nil {
				continue
			}
			log.Debug().Msgf("Polling .....")
			switch s := socket.Socket; s {
			case transient_shell_channel:
				msg, _ := s.Recv(0)
				log.Debug().Msgf("Received from Shell socket: %s\n", msg)
				shellFuture = true
			case transient_control_channel:
				msg, _ := s.Recv(0)
				log.Debug().Msgf("Received from Control socket: %s\n", msg)
				controlFuture = true
			case iopub_channel:
				msg, _ := s.Recv(0)
				log.Debug().Msgf("Received from IoPub socket: %s\n", msg)
				infoFuture = true
			}
		}

	}
	transient_control_channel.Close()
	transient_shell_channel.Close()
	log.Debug().Msgf("Nudge successful")
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

	var msg kernel.Message
	// var msgList []interface{}
	// msgList = make([]interface{}, 0)
	var channel string

	if kwsConn.Subprotocol == "v1.kernel.websocket.jupyter.org" {
		// channel, msgList = deserializeMsgFromWsV1(wsMsg)
		msg = kernel.Message{}
	} else {
		// if isBinary(wsMsg) { // Implement your binary check
		// 	msg = deserializeBinaryMessage([]byte(wsMsg))
		// } else {
		if err := json.Unmarshal([]byte(wsMsg), &msg); err != nil {
			log.Info().Msgf("Error unmarshalling message: %s", err)
			return
		}
		log.Debug().Msgf("msg is => %v", msg)

		kwsConn.Session.SendStreamMsg(kwsConn.Channels["shell"], msg)

		// msgList = []interface{}{}
		// channel = msg.Header["channel"].(string)
		// delete(msg.Header, "channel")
	}

	if channel == "" {
		log.Debug().Msgf("No channel specified, assuming shell: %v", msg)
		channel = "shell"
	}

	if _, ok := kwsConn.Channels[channel]; !ok {
		log.Debug().Msgf("No such channel: %v", channel)
		return
	}

	allowedMsgTypes := kwsConn.getAllowedMessageTypes()
	ignoreMsg := false

	if len(allowedMsgTypes) > 0 {
		// msg.Header = kwsConn.GetPart("header", msg.Header, msgList)
		if (msg.Header == kernel.MessageHeader{}) {
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
		log.Debug().Msgf("stream %s", stream)
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
		msgListPtr, ok := msgList.([]*kernel.Message)
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

func (kwsConn *KernelWebSocketConnection) Disconnect() {
	log.Printf("WebSocket closed %s", kwsConn.Session.Key)

	// Unregister if this session key corresponds to the current websocket handler
	// if kwsConn.OpenSessions[kwsConn.Session.Key] == kwsConn {
	// 	delete(kwsConn.OpenSessions, kwsConn.Session.Key)
	// }

	if _, exists := kernel.ZasperActiveKernels[kwsConn.KernelId]; exists {
		kernel.NotifyDisconnect(kwsConn.KernelId)
		// kernel.RemoveRestartCallback(kwsConn.KernelId, kwsConn.onKernelRestarted)
		// kernel.RemoveRestartCallback(kwsConn.KernelId, kwsConn.onRestartFailed, "dead")

		// Start buffering if this was the last connection
		// if connections, exists := kernel.ZasperActiveKernels[kwsConn.KernelId]; exists && connections == 0 {
		// 	kernel.StartBuffering(kwsConn.KernelId, kwsConn.Session.Key, kwsConn.Channels)
		// 	// Assuming _openSockets is a global or package-level variable
		// 	removeOpenSocket(kwsConn)
		// 	// kwsConn.closeFuture.Done()
		// 	return
		// }
	}

	// Handle closing streams
	// for _, stream := range kwsConn.Channels {
	// 	if stream != nil && !stream.IsClosed() {
	// 		// stream.OnRecv(nil)
	// 		stream.Close()
	// 	}
	// }

	// Clear the channels
	kwsConn.Channels = make(map[string]*zmq4.Socket)
	// Attempt to remove from open sockets
	removeOpenSocket(kwsConn)
	// kwsConn.closeFuture.Done()
}

func removeOpenSocket(kwsConn *KernelWebSocketConnection) {
	panic("unimplemented")
}

func registerWebSocketSession(sessionId string) {
	log.Info().Msgf("registering a new session: %s", sessionId)
}

func (kwsConn KernelWebSocketConnection) writeStderr(errorMessage string, parentHeader interface{}) {
	// Write a message to stderr
	log.Printf("Warning: %s", errorMessage)

	// errMsg := kwsConn.Session.msg("stream", map[string]interface{}{
	// 	"text": errorMessage + "\n",
	// 	"name": "stderr",
	// }, parentHeader)
	errMsg := make(map[string]string)

	if kwsConn.Subprotocol == "v1.kernel.websocket.jupyter.org" {
		// binMsg := serializeMsgToWSV1(errMsg, "iopub", kwsConn.Session.pack)
		// binMsg := ""
		// kwsConn.writeMessage(binMsg, true)
	} else {
		errMsg["channel"] = "iopub"
		// msgBytes, _ := json.Marshal(errMsg) // Handle error in production code
		// kwsConn.writeMessage(string(msgBytes), false)
	}
}

// Define a callback type => Use when we switch to Reactive pattern
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
