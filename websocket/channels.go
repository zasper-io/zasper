package websocket

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/kernel"

	"github.com/go-zeromq/zmq4"
)

const DELIM = "<IDS|MSG>"

type KernelWebSocketConnection struct {
	pollingWait          sync.WaitGroup
	Conn                 *websocket.Conn
	Send                 chan []byte
	KernelId             string
	KernelManager        kernel.KernelManager
	LimitRate            bool
	IOpubMsgRateLimit    int
	IOpubDataRateLimit   int
	RateLimitWindow      int
	Context              context.Context
	PollingCancel        context.CancelFunc
	OpenSessions         map[string]kernel.KernelSession
	OpenSockets          []string
	Channels             map[string]zmq4.Socket
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
			log.Debug().Msgf("Polling of %q socket finished.", socketName)
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
				log.Debug().Msgf("Polling of %q socket started.", socketName)

				zmsg, err2 := socket.Recv()
				if err2 != nil {
					log.Info().Msgf("could not receive message: %v", err2)
					continue
				}
				log.Printf("[%s] %s\n", zmsg.Frames[0], zmsg.Frames[1])

				kwsConn.Send <- kwsConn.Session.Deserialize(zmsg)
			}
		}
	}()
}

func (kwsConn *KernelWebSocketConnection) startPolling() { //msg interface{}, binary bool
	iopub_channel := kwsConn.Channels["iopub"]
	// shell_channel := kwsConn.Channels["shell"]

	kwsConn.pollChannel(iopub_channel, "iopub")
}

func (kwsConn *KernelWebSocketConnection) prepare(sessionId string) {
	km := kwsConn.KernelManager
	if km.Ready {
		log.Info().Msgf("%s", km.Session.Key)
	} else {
		log.Info().Msg("Kernel is not ready")
	}
	kwsConn.Session = km.Session
}

func (kwsConn *KernelWebSocketConnection) connect() {
	log.Info().Msg("notifying connection")
	kernel.NotifyConnect()

	log.Info().Msg("creating stream")
	kwsConn.createStream()

	log.Info().Msg("Nudging the kernel")
	kwsConn.nudge()

	// subscribe
	kwsConn.startPolling()
}

func (kwsConn *KernelWebSocketConnection) createStream() {

	// connect on iopub, shell, control, stdin
	// not sure about hb

	cinfo := kwsConn.KernelManager.ConnectionInfo
	context := kwsConn.Context
	kwsConn.Channels["iopub"] = cinfo.ConnectIopub(context)
	kwsConn.Channels["shell"] = cinfo.ConnectShell(context)
	kwsConn.Channels["control"] = cinfo.ConnectControl(context)
	kwsConn.Channels["stdin"] = cinfo.ConnectStdin(context)
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
	kernelInfoRequest2 := kwsConn.Session.MessageFromString("kernel_info_request")

	context := context.Background()
	transient_shell_channel := kwsConn.KernelManager.ConnectionInfo.ConnectShell(context)
	transient_control_channel := kwsConn.KernelManager.ConnectionInfo.ConnectControl(context)

	kwsConn.Session.SendStreamMsg(transient_control_channel, kernelInfoRequest)
	kwsConn.Session.SendStreamMsg(transient_shell_channel, kernelInfoRequest2)

	msg, err := transient_shell_channel.Recv()
	if err != nil {
		log.Info().Msgf("dealer failed to recv message: %v", err)
	}

	log.Info().Msgf("%s", kwsConn.Session.Deserialize(msg))

	transient_control_channel.Close()
	transient_shell_channel.Close()
	log.Debug().Msgf("Nudge successful")
}

func (kwsConn *KernelWebSocketConnection) handleIncomingMessage(messageType int, incomingMsg []byte) {

	wsMsg := incomingMsg
	if len(kwsConn.Channels) == 0 {
		log.Printf("Received message on closed websocket: %v", wsMsg)
		return
	}

	var msg kernel.Message
	if kwsConn.Subprotocol == "v1.kernel.websocket.jupyter.org" {
		msg = kernel.Message{}
	} else {
		if err := json.Unmarshal([]byte(wsMsg), &msg); err != nil {
			log.Info().Msgf("Error unmarshalling message: %s", err)
			return
		}
		log.Debug().Msgf("msg is => %v", msg)

		kwsConn.Session.SendStreamMsg(kwsConn.Channels["shell"], msg)
	}
}
