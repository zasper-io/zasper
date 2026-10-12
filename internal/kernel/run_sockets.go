package kernel

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/go-zeromq/zmq4"
	"github.com/rs/zerolog/log"
)

/*
runSockets is the kernel's own shell and stdin, which every run is sent on, whoever asks for it.

A kernel sends an input() prompt to the identity that sent the run. When that was a browser tab's own
socket and the tab has gone, ZeroMQ drops the prompt, nobody can answer it, and the kernel waits for ever.
Sent from here instead, the prompt always reaches the server: the journal keeps it on the run, every
attached tab is shown it, and a tab that attaches later is replayed it. Each run's execute_reply comes
back here too, and is passed to whoever asked by the request's msg_id.
*/
type runSockets struct {
	mu    sync.Mutex
	shell zmq4.Socket
	stdin zmq4.Socket
	// Closed once both are dialled.
	ready chan struct{}
	// Whoever asked for each run, told its execute_reply.
	replies map[string]func([]byte)
}

// serveRuns dials the kernel's own shell and stdin and reads both, for as long as ctx lasts.
func (km *KernelManager) serveRuns(ctx context.Context) {
	sockets := km.runSockets()
	id := zmq4.SocketIdentity(fmt.Sprintf("runs-%s", km.KernelId))
	shell := km.ConnectionInfo.ConnectShell(ctx, id)
	stdin := km.ConnectionInfo.ConnectStdin(ctx, id)
	sockets.mu.Lock()
	sockets.shell, sockets.stdin = shell, stdin
	sockets.mu.Unlock()
	close(sockets.ready)

	go km.readShell(ctx, shell)
	km.readStdin(ctx, stdin)
	shell.Close()
	stdin.Close()
}

func (km *KernelManager) runSockets() *runSockets {
	km.runsOnce.Do(func() {
		km.runs = &runSockets{ready: make(chan struct{}), replies: map[string]func([]byte){}}
	})
	return km.runs
}

func (km *KernelManager) readShell(ctx context.Context, shell zmq4.Socket) {
	sockets := km.runSockets()
	for {
		zmsg, err := shell.Recv()
		if err != nil {
			if ctx.Err() == nil {
				log.Debug().Err(err).Msgf("stopped reading kernel %s's runs", km.KernelId)
			}
			return
		}
		message, ok := km.Session.decode(zmsg, "shell")
		if !ok {
			continue
		}
		parent := message.ParentHeader.MsgID
		sockets.mu.Lock()
		reply := sockets.replies[parent]
		if message.Header.MsgType == "execute_reply" {
			delete(sockets.replies, parent)
		}
		sockets.mu.Unlock()
		if reply != nil {
			if payload := encodeForClient(message); payload != nil {
				reply(payload)
			}
		}
	}
}

func (km *KernelManager) readStdin(ctx context.Context, stdin zmq4.Socket) {
	for {
		zmsg, err := stdin.Recv()
		if err != nil {
			return
		}
		message, ok := km.Session.decode(zmsg, "stdin")
		if ok && message.Header.MsgType == "input_request" {
			km.feed.askInput(message)
		}
	}
}

/*
Execute sends a run on the kernel's own shell, recording it in the journal first. reply, when not nil, is
told the run's execute_reply. It waits for the sockets to be dialled, up to KernelStartupBudget.
*/
func (km *KernelManager) Execute(request Message, cellID, client string, reply func([]byte)) error {
	sockets := km.runSockets()
	select {
	case <-sockets.ready:
	case <-time.After(KernelStartupBudget):
		return ErrKernelNotReady
	}
	content, _ := request.Content.(map[string]interface{})
	if silent, _ := content["silent"].(bool); !silent {
		code, _ := content["code"].(string)
		km.BeginRun(request.Header.MsgID, cellID, client, code)
	}
	sockets.mu.Lock()
	if reply != nil {
		sockets.replies[request.Header.MsgID] = reply
	}
	shell := sockets.shell
	sockets.mu.Unlock()
	return km.Session.send(shell, request)
}

// Answer sends an input_reply on the kernel's own stdin, where the prompt it answers came from.
func (km *KernelManager) Answer(reply Message) error {
	sockets := km.runSockets()
	select {
	case <-sockets.ready:
	default:
		return ErrKernelNotReady
	}
	km.feed.inputAnswered()
	sockets.mu.Lock()
	stdin := sockets.stdin
	sockets.mu.Unlock()
	return km.Session.send(stdin, reply)
}
