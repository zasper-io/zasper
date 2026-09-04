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

// How often the handshake asks the kernel again. Its overall budget is KernelStartupBudget, the same one
// a dial spends: both are waiting for the same kernel to come up.
const nudgeRetryInterval = 500 * time.Millisecond

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
	closeOnce            sync.Once

	// The handshake. `iopubSeen` is closed by the iopub poller on the first message it receives, `ready`
	// once the kernel has both answered a kernel_info_request and published that message. Made by
	// signals() rather than here: this struct is built as a literal, and a receive on a nil channel waits
	// forever.
	ready         chan struct{}
	iopubSeen     chan struct{}
	readyOnce     sync.Once
	iopubSeenOnce sync.Once
}

// signals answers the two handshake channels, creating them the first time anything asks for them.
func (kwsConn *KernelWebSocketConnection) signals() (ready, iopubSeen chan struct{}) {
	kwsConn.mu.Lock()
	defer kwsConn.mu.Unlock()

	if kwsConn.ready == nil {
		kwsConn.ready = make(chan struct{})
		kwsConn.iopubSeen = make(chan struct{})
	}
	return kwsConn.ready, kwsConn.iopubSeen
}

// iopubArrived records that the kernel has published something, which is the half of the handshake that
// says this connection's subscription is live: ZeroMQ drops a publication nobody is subscribed to yet.
func (kwsConn *KernelWebSocketConnection) iopubArrived() {
	_, iopubSeen := kwsConn.signals()
	kwsConn.iopubSeenOnce.Do(func() { close(iopubSeen) })
}

// waitReady blocks until the handshake has finished and says whether it did: a false means the
// connection was closed while waiting, and whatever was waiting on it should be dropped.
func (kwsConn *KernelWebSocketConnection) waitReady() bool {
	ready, _ := kwsConn.signals()
	select {
	case <-ready:
		return true
	case <-kwsConn.Context.Done():
		return false
	}
}

// Close stops polling and closes the client socket, so a browser holding this
// connection learns its kernel is gone. Safe to call more than once.
func (kwsConn *KernelWebSocketConnection) Close() {
	kwsConn.closeOnce.Do(func() {
		kwsConn.stopPolling()
		if kwsConn.Conn != nil {
			kwsConn.Conn.Close()
		}
	})
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
					log.Error().Msgf("could not receive message: %v", err2)
					continue
				}
				log.Debug().Msgf("channel: [%s] [%s] %s\n", socketName, zmsg.Frames[0], zmsg.Frames[1])

				if socketName == "iopub" {
					// Before the send rather than after: what the handshake is waiting for is that the
					// kernel's publications reach this socket, not that this one reaches the client.
					kwsConn.iopubArrived()
				}

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
		log.Debug().Msgf("%s", km.Session.Key)
	} else {
		log.Debug().Msg("Kernel is not ready")
	}
	kwsConn.Session = km.Session
}

func (kwsConn *KernelWebSocketConnection) Connect() {
	log.Debug().Msg("notifying connection")
	NotifyConnect()

	log.Debug().Msg("creating stream")
	kwsConn.createStream()

	// Polling before the nudge, and the nudge behind it: half of the handshake is an iopub message, and
	// the loops started here are the only readers of that socket. It also means the connection is open as
	// soon as its sockets are — what waits for the kernel is the client's first message, in
	// handleIncomingMessage, and not the connection itself.
	log.Debug().Msg("Start polling")
	kwsConn.startPolling()

	log.Debug().Msg("Nudging the kernel")
	go kwsConn.nudge()
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

/*
nudge asks the kernel to say something and closes `ready` once it has: a reply on the shell socket and at
least one message on iopub, which together mean the kernel is listening and this connection's
subscriptions are established. Client messages are held until then (see waitReady), because an
execute_request the kernel answers before its iopub stream reaches us is answered into nothing — ZeroMQ
drops a publication that has no subscriber yet, so the cell runs and its output is never sent to anyone.

It keeps asking rather than asking once and assuming, which is what it used to do: the request can be
sent before the kernel is reading its shell socket, and answered before the SUB socket is subscribed. A
kernel that has still said nothing at the end of the budget is given up on and the connection used
anyway — the client then sees a kernel that does not answer, which is what it has, rather than a
notebook whose cells never leave.
*/
func (kwsConn *KernelWebSocketConnection) nudge() {
	ready, iopubSeen := kwsConn.signals()
	// However this ends: a client waiting on the handshake must not wait longer than the handshake does.
	defer kwsConn.readyOnce.Do(func() { close(ready) })

	id := zmq4.SocketIdentity(fmt.Sprintf("channel-%s", uuid.New().String()))
	// A socket of its own, so the reply to a request the client never made is not forwarded to it as if
	// it had. On the connection's context, so closing the connection stops the dial and the receive.
	transientShell := kwsConn.KernelManager.ConnectionInfo.ConnectShell(kwsConn.Context, id)
	defer transientShell.Close()

	replied := make(chan error, 1)
	go func() {
		// One receive for however many requests it takes: any reply answers the only question being
		// asked, which is whether the kernel is there at all.
		_, err := transientShell.Recv()
		replied <- err
	}()

	ask := func() {
		kwsConn.Session.SendStreamMsg(transientShell, kwsConn.Session.MessageFromString("kernel_info_request"))
	}
	ask()

	deadline := time.After(KernelStartupBudget)
	retry := time.NewTicker(nudgeRetryInterval)
	defer retry.Stop()

	// Each half is set to nil as it arrives. A nil channel is never chosen, so neither is waited for
	// twice and the one already in does not spin the loop while the other is outstanding.
	for replied != nil || iopubSeen != nil {
		select {
		case err := <-replied:
			if err != nil {
				log.Error().Msgf("nudge failed to receive on the shell socket: %v", err)
				return
			}
			replied = nil
		case <-iopubSeen:
			iopubSeen = nil
		case <-retry.C:
			ask()
		case <-deadline:
			log.Warn().Msgf("kernel %s did not answer within %s; using the connection anyway",
				kwsConn.KernelId, KernelStartupBudget)
			return
		case <-kwsConn.Context.Done():
			return
		}
	}
	log.Debug().Msg("Nudge successful")
}

func (kwsConn *KernelWebSocketConnection) handleIncomingMessage(incomingMsg []byte) {

	wsMsg := incomingMsg
	if len(kwsConn.Channels) == 0 {
		log.Printf("Received message on closed websocket: %v", wsMsg)
		return
	}

	// Held until the kernel has answered the nudge and its iopub stream has been seen. A cell run the
	// moment a notebook opens is the case this is for: sent any earlier it executes on a kernel whose
	// publications have nowhere to go.
	if !kwsConn.waitReady() {
		log.Debug().Msg("dropping a message on a connection that closed before its kernel answered")
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
			err := kwsConn.Conn.WriteMessage(websocket.TextMessage, message)
			kwsConn.mu.Unlock()
			if err != nil {
				log.Info().Msgf("Error writing message: %s", err)
				return
			}
		}
	}
}
