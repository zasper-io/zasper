package kernel

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/go-zeromq/zmq4"
)

const (
	// How often a kernel that has published nothing yet is asked again.
	watchNudgeInterval = 500 * time.Millisecond
	// How long loading the inspector into a kernel that is up may take.
	helperTimeout = 30 * time.Second
)

/*
watchKernelActivity subscribes to a kernel's iopub for as long as the kernel runs. It is the kernel's only
iopub subscription: /api/kernels reads what the kernel is doing from it, the run journal keeps output
from it while no browser is attached, and every client's iopub is fanned out from it. The first thing it
hears marks the kernel up, which everything else that dials the kernel waits for.
*/
func watchKernelActivity(ctx context.Context, km *KernelManager) {
	// Patient: dialling waits for the kernel to bind its ports, however long that takes, which is why
	// this runs on a goroutine of its own.
	socket := km.ConnectionInfo.connectIopub(ctx, true)
	defer socket.Close()

	published := make(chan struct{})
	go nudgeUntilPublished(ctx, km, published)

	heard := false
	for {
		zmsg, err := socket.Recv()
		if err != nil {
			// The kernel has gone, or the watch was cancelled: either way there is nothing more to hear.
			if ctx.Err() == nil {
				log.Debug().Msgf("stopped watching kernel %s: %v", km.KernelId, err)
			}
			return
		}
		if !heard {
			heard = true
			close(published)
			km.markUp()
			go loadHelper(ctx, km)
		}
		km.recordActivity(km.publish(zmsg))
	}
}

/*
nudgeUntilPublished asks a kernel what it is until the watch above hears it publish, and keeps the first
kernel_info_reply: the kernel's own account of its protocol version, implementation and language.

A kernel publishes nothing until it is spoken to, so a watch on its own would leave a kernel reported as
"starting" for as long as it ran. The client handshake asks the same question, but it goes with the
client: a notebook closed while its kernel was still starting left the server with a kernel it could
never say anything about. jupyter_server nudges from the server side for the same reason.
*/
func nudgeUntilPublished(ctx context.Context, km *KernelManager, published <-chan struct{}) {
	// A socket of its own, so the reply to a request no client made is not taken for an answer to one.
	id := zmq4.SocketIdentity(fmt.Sprintf("watch-%s", uuid.New().String()))
	shell := km.ConnectionInfo.connectShell(ctx, id, true)
	defer shell.Close()

	answered := make(chan struct{})
	go func() {
		for {
			zmsg, err := shell.Recv()
			if err != nil {
				return
			}
			if reply, ok := km.Session.decode(zmsg, "shell"); ok && reply.Header.MsgType == "kernel_info_reply" {
				km.recordInfo(reply)
				close(answered)
				return
			}
		}
	}()

	ask := func() {
		// Debug, not error: a send that fails here is the kernel going away, which the watch reports.
		if err := km.Session.send(shell, km.Session.MessageFromString("kernel_info_request")); err != nil {
			log.Debug().Msgf("could not ask kernel %s what it is doing: %v", km.KernelId, err)
		}
	}
	ask()

	retry := time.NewTicker(watchNudgeInterval)
	defer retry.Stop()

	// For as long as the kernel lives: one slow to start is still starting, not gone. Each is set to nil
	// as it arrives, so it is not waited for twice.
	for published != nil || answered != nil {
		select {
		case <-published:
			published = nil
		case <-answered:
			answered = nil
		case <-retry.C:
			ask()
		case <-ctx.Done():
			return
		}
	}
}

// stopWatchingKernel ends the watch on a stopped kernel. A manager built outside Kernels.Start never
// started one.
func stopWatchingKernel(km *KernelManager) {
	if km.stopWatching != nil {
		km.stopWatching()
	}
}

// loadHelper loads the inspector into a Python kernel as soon as it answers. A kernel of any other
// language is left alone.
func loadHelper(ctx context.Context, km *KernelManager) {
	if !strings.EqualFold(km.Spec.Language, "python") {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, helperTimeout)
	defer cancel()
	if err := km.LoadHelper(ctx); err != nil && ctx.Err() == nil {
		log.Debug().Err(err).Msgf("could not load the inspector into kernel %s", km.KernelId)
	}
}
