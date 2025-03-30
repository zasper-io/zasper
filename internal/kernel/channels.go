package kernel

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	"github.com/go-zeromq/zmq4"
)

const DELIM = "<IDS|MSG>"

type KernelWebSocketConnection struct {
	pollingWait          sync.WaitGroup
	Conn                 *websocket.Conn
	Send                 chan []byte
	KernelId             string
	KernelManager        KernelManager
	Context              context.Context
	PollingCancel        context.CancelFunc
	Channels             map[string]zmq4.Socket
	Session              KernelSession
	IOPubWindowMsgCount  int
	IOPubWindowByteCount int
	IOPubMsgsExceeded    int
	IOPubDataExceeded    int
	IOPubWindowByteQueue []interface{}
	KernelInfoChannel    zmq4.Socket
	Subprotocol          string
	mu                   sync.Mutex
}

func (kwsConn *KernelWebSocketConnection) stopPolling() {
	// Call the cancel function to stop the polling goroutine
	kwsConn.mu.Lock()
	defer kwsConn.mu.Unlock()

	if kwsConn.PollingCancel != nil {
		kwsConn.PollingCancel()
		log.Info().Msg("Polling stopped.")
	} else {
		log.Warn().Msg("Polling was not started.")
	}
}

func (kwsConn *KernelWebSocketConnection) pollChannel(socket zmq4.Socket, socketName string) {
	kwsConn.mu.Lock()
	kwsConn.pollingWait.Add(1)
	kwsConn.mu.Unlock()
	go func() {
		defer func() {
			log.Info().Msgf("Polling of %q socket finished.", socketName)
			kwsConn.mu.Lock()
			kwsConn.pollingWait.Done()
			kwsConn.mu.Unlock()
		}()
		for {
			select {
			case <-kwsConn.Context.Done(): // Check if context is canceled
				log.Debug().Msgf("Polling of %q socket canceled.", socketName)
				return
			default:
				log.Debug().Msgf("Receive message on %q chanel.", socketName)

				zmsg, err2 := socket.Recv()
				if err2 != nil {
					log.Info().Msgf("could not receive message: %v", err2)
					continue
				}
				log.Debug().Msgf("channel: [%s] [%s] %s\n", socketName, zmsg.Frames[0], zmsg.Frames[1])

				kwsConn.Send <- kwsConn.Session.Deserialize(zmsg, socketName)
			}
		}
	}()
}

func (kwsConn *KernelWebSocketConnection) startPolling() { //msg interface{}, binary bool
	iopub_channel := kwsConn.Channels["iopub"]
	stdin_channel := kwsConn.Channels["stdin"]
	control_channel := kwsConn.Channels["control"]
	shell_channel := kwsConn.Channels["shell"]

	kwsConn.pollChannel(iopub_channel, "iopub")
	kwsConn.pollChannel(control_channel, "control")
	kwsConn.pollChannel(stdin_channel, "stdin")
	kwsConn.pollChannel(shell_channel, "shell")
}

func (kwsConn *KernelWebSocketConnection) Prepare(sessionId string) {
	km := kwsConn.KernelManager
	if km.Ready {
		log.Info().Msgf("%s", km.Session.Key)
	} else {
		log.Info().Msg("Kernel is not ready")
	}
	kwsConn.Session = km.Session
}

func (kwsConn *KernelWebSocketConnection) Connect() {
	log.Info().Msg("notifying connection")
	NotifyConnect()

	log.Info().Msg("creating stream")
	kwsConn.createStream()

	log.Info().Msg("Nudging the kernel")
	kwsConn.nudge()

	log.Info().Msg("Start polling")
	// subscribe
	kwsConn.startPolling()
}

func (kwsConn *KernelWebSocketConnection) createStream() {

	// connect on iopub, shell, control, stdin
	// not sure about hb
	id := zmq4.SocketIdentity(fmt.Sprintf("channel-%s", uuid.New().String()))
	cinfo := kwsConn.KernelManager.ConnectionInfo
	context := kwsConn.Context
	kwsConn.Channels["iopub"] = cinfo.ConnectIopub(context)
	kwsConn.Channels["shell"] = cinfo.ConnectShell(context, id)
	kwsConn.Channels["control"] = cinfo.ConnectControl(context)
	kwsConn.Channels["stdin"] = cinfo.ConnectStdin(context, id)
	kwsConn.Channels["hb"] = cinfo.ConnectHb(context)
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

	context := context.Background()
	id := zmq4.SocketIdentity(fmt.Sprintf("channel-%s", uuid.New().String()))
	transient_shell_channel := kwsConn.KernelManager.ConnectionInfo.ConnectShell(context, id)

	kwsConn.Session.SendStreamMsg(transient_shell_channel, kernelInfoRequest)

	// Set up the timeout duration
	timeout := time.After(2 * time.Second)

	// Channel to receive message or error
	result := make(chan struct {
		msg zmq4.Msg
		err error
	}, 1)

	// Run Recv in a goroutine
	go func() {
		msg, err := transient_shell_channel.Recv()
		result <- struct {
			msg zmq4.Msg
			err error
		}{msg, err}
	}()

	// Use select to either handle the received message or timeout
	select {
	case res := <-result:
		if res.err != nil {
			log.Info().Msgf("dealer failed to recv message: %v", res.err)
		} else {
			log.Info().Msgf("%s", kwsConn.Session.Deserialize(res.msg, "shell"))
		}
	case <-timeout:
		log.Warn().Msg("Timeout waiting for response from shell channel")
	}
	log.Info().Msg("closing connection")
	transient_shell_channel.Close()
	log.Debug().Msgf("Nudge successful")
}

func (kwsConn *KernelWebSocketConnection) handleIncomingMessage(incomingMsg []byte) {

	wsMsg := incomingMsg
	if len(kwsConn.Channels) == 0 {
		log.Printf("Received message on closed websocket: %v", wsMsg)
		return
	}

	var msg Message
	if kwsConn.Subprotocol == "v1.kernel.websocket.jupyter.org" {
		msg = Message{}
	} else {
		if err := json.Unmarshal([]byte(wsMsg), &msg); err != nil {
			log.Info().Msgf("Error unmarshalling message: %s", err)
			return
		}
		log.Debug().Msgf("msg is => %v", msg)
		if msg.Channel == "stdin" {
			kwsConn.Session.SendStreamMsg(kwsConn.Channels["stdin"], msg)
		} else {
			kwsConn.Session.SendStreamMsg(kwsConn.Channels["shell"], msg)
		}

	}
}

func (kwsConn *KernelWebSocketConnection) ReadMessagesFromClient(waiter *sync.WaitGroup) {
	defer func() {
		log.Info().Msg("Closing readMessagesFromClient")
		kwsConn.Conn.Close()
		waiter.Done()
	}()

	for {
		select {
		case <-kwsConn.Context.Done(): // Check if context is canceled
			log.Debug().Msgf("Socket closed, Incoming message handler stopped")
			return
		default:
			messageType, data, err := kwsConn.Conn.ReadMessage()
			if err != nil {
				log.Debug().Msgf("%s", err)
				return
			}
			log.Debug().Msgf("message type => %d", messageType)
			kwsConn.handleIncomingMessage(data)
		}

	}
}

func (kwsConn *KernelWebSocketConnection) WriteMessages(waiter *sync.WaitGroup) {
	defer func() {
		kwsConn.Conn.Close()
		waiter.Done()
	}()
	for {
		select {
		case <-kwsConn.Context.Done(): // Check if context is canceled
			log.Debug().Msgf("Socket closed, Incoming message handler stopped")
			return
		default:
			message, ok := <-kwsConn.Send
			if !ok {
				log.Info().Msg("Send channel closed, closing WebSocket connection")
				kwsConn.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			kwsConn.mu.Lock()
			if err := kwsConn.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Info().Msgf("Error writing message: %s", err)
				return
			}
			kwsConn.mu.Unlock()
		}
	}
}
