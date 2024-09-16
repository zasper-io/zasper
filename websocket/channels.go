package websocket

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"
	"zasper_go/kernel"

	"github.com/pebbe/zmq4"
)

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
}

func (kwsConn *KernelWebSocketConnection) prepare(sessionId string) {
	registerWebSocketSession(sessionId)
	km := kwsConn.KernelManager
	if km.Ready {
		log.Println("===========Kernel is ready=============")
		log.Println(km.Session.Key)
	} else {
		log.Println("===========Kernel is not ready============")
	}
	// raise timeout error
	kwsConn.Session = km.Session

	//request_kernel_info -> connect shell socket
}

func (kwsConn *KernelWebSocketConnection) connect() {
	log.Println("notifying connection")
	kernel.NotifyConnect()

	log.Println("creating stream")
	kwsConn.createStream()

	log.Println("Nudging the kernel")
	kwsConn.nudge()
}

func (kwsConn *KernelWebSocketConnection) createStream() {

	// connect on iopub, shell, control, stdin
	// not sure about hb

	cinfo := kwsConn.KernelManager.ConnectionInfo
	kwsConn.Channels["iopub"] = connect_iopub(cinfo)
	kwsConn.Channels["shell"] = connect_shell(cinfo)
	kwsConn.Channels["control"] = connect_control(cinfo)
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
	transient_shell_channel := connect_hb(kwsConn.KernelManager.ConnectionInfo)
	// shell returns info future
	count := 0
	for {

		kwsConn.Session.SendStreamMsg(transient_shell_channel, "kernelInfoRequest")

		// Create a Poller
		poller := zmq4.NewPoller()
		poller.Add(transient_shell_channel, zmq4.POLLIN)

		// Poll with a timeout (e.g., 5 seconds)
		events, err := poller.Poll(5 * time.Second)
		if err != nil {
			fmt.Println("Error during polling:", err)
			return
		}

		// Check if the DEALER socket is ready for reading
		for _, event := range events {
			if event.Socket == transient_shell_channel {
				// Receive the response
				response, err := transient_shell_channel.Recv(0)
				if err != nil {
					fmt.Println("Error receiving message:", err)
					return
				}
				fmt.Printf("Received response: %s\n", response)
				return
			}
		}

		// If no events occurred within the timeout period
		fmt.Println("No response received within the timeout period trial count:", count)

		count++
	}
}

func (kwsConn *KernelWebSocketConnection) handleIncomingMessage(messageType int, ws_msg []byte) {
	msg, _ := deserializeBinaryMessage(ws_msg)
	log.Println(msg)
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
	log.Println("registering a new session: ", sessionId)
}

func makeURL(channel string, port int) string {
	ip := "127.0.0.1"
	// port := 1 // TODO getPort
	Transport := "tcp"
	if Transport == "tcp" {
		return fmt.Sprintf("tcp://%s:%d", ip, port)
	}
	return fmt.Sprintf("%s://%s-%d", Transport, ip, port)
}

// cst["shell"] = zmq4.Dealer
// "shell_port": 3503,
func connect_shell(cinfo kernel.Connection) *zmq4.Socket {
	channel := "shell"
	url := makeURL(channel, cinfo.ShellPort)

	socket, _ := zmq4.NewSocket(zmq4.DEALER)
	socket.Connect(url)

	return socket

}

// cst["control"] = zmq4.Dealer
// "control_port": 4714,
func connect_control(cinfo kernel.Connection) *zmq4.Socket {
	channel := "control"
	url := makeURL(channel, cinfo.ControlPort)

	socket, _ := zmq4.NewSocket(zmq4.DEALER)
	socket.Connect(url)
	return socket

}

// cst["iopub"] = zmq4.Sub
// "iopub_port": 1206,
func connect_iopub(cinfo kernel.Connection) *zmq4.Socket {
	channel := "iopub"
	url := makeURL(channel, cinfo.IopubPort)

	socket, _ := zmq4.NewSocket(zmq4.SUB)
	socket.Connect(url)

	return socket

}

// cst["stdin"] = zmq4.Dealer
// "stdin_port": 3266,
func connect_stdin(cinfo kernel.Connection) *zmq4.Socket {
	channel := "stdin"
	url := makeURL(channel, cinfo.StdinPort)
	socket, _ := zmq4.NewSocket(zmq4.DEALER)
	socket.Connect(url)
	return socket

}

// cst["hb"] = zmq4.Req
// "hb_port": 4283,
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
			log.Println("Error receiving message:", err)
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

// Deserialize function
func deserialize(
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
		check := sign(msgList[1:5], authKey)
		if !hmac.Equal(signature, check) {
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
	message.MsgID = message.Header["msg_id"].(string)
	message.MsgType = message.Header["msg_type"].(string)

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
	message.Buffers = msgList[5:]

	// Debug print
	fmt.Printf("Message: %+v\n", message)

	// Adapt to the current version (implement as needed)
	// message = adapt(message)

	return message, nil
}

// Function to sign the message parts
func sign(parts [][]byte, key []byte) []byte {
	h := hmac.New(sha256.New, key)
	for _, part := range parts {
		h.Write(part)
	}
	return h.Sum(nil)
}
