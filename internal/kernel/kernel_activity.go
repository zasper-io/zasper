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

// How often a kernel that has published nothing yet is asked again, within KernelStartupBudget.
const watchNudgeInterval = 500 * time.Millisecond

/*
watchKernelActivity subscribes to a kernel's iopub for as long as the kernel runs. It is the kernel's only
iopub subscription: /api/kernels reads what the kernel is doing from it, the run journal keeps output
from it while no browser is attached, and every client's iopub is fanned out from it.
*/
func watchKernelActivity(ctx context.Context, km *KernelManager) {
	// Dialling waits for the kernel to bind its ports, which is why this runs on a goroutine of its own.
	socket := km.ConnectionInfo.ConnectIopub(ctx)
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
			go loadHelper(ctx, km)
		}
		km.recordActivity(km.publish(zmsg))
	}
}

/*
nudgeUntilPublished asks a kernel to answer something, and stops as soon as the watch above hears it.

A kernel publishes nothing until it is spoken to, so a watch on its own would leave a kernel reported as
"starting" for as long as it ran. The client handshake asks the same question, but it goes with the
client: a notebook closed while its kernel was still starting left the server with a kernel it could
never say anything about. jupyter_server nudges from the server side for the same reason.
*/
func nudgeUntilPublished(ctx context.Context, km *KernelManager, published <-chan struct{}) {
	// A socket of its own, so the reply to a request no client made is not taken for an answer to one.
	id := zmq4.SocketIdentity(fmt.Sprintf("watch-%s", uuid.New().String()))
	shell := km.ConnectionInfo.ConnectShell(ctx, id)
	defer shell.Close()

	ask := func() {
		// Debug, not error: a send that fails here is the kernel going away, which the watch reports.
		if err := km.Session.send(shell, km.Session.MessageFromString("kernel_info_request")); err != nil {
			log.Debug().Msgf("could not ask kernel %s what it is doing: %v", km.KernelId, err)
		}
	}
	ask()

	deadline := time.After(KernelStartupBudget)
	retry := time.NewTicker(watchNudgeInterval)
	defer retry.Stop()

	for {
		select {
		case <-published:
			return
		case <-retry.C:
			ask()
		case <-deadline:
			log.Debug().Msgf("kernel %s published nothing within %s", km.KernelId, KernelStartupBudget)
			return
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
	ctx, cancel := context.WithTimeout(ctx, KernelStartupBudget)
	defer cancel()
	if err := km.LoadHelper(ctx); err != nil && ctx.Err() == nil {
		log.Debug().Err(err).Msgf("could not load the inspector into kernel %s", km.KernelId)
	}
}
