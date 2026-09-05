package kernel

import (
	"context"

	"github.com/rs/zerolog/log"
)

/*
What /api/kernels can say about a kernel nobody is looking at.

A kernel says what it is doing on iopub and nowhere else, so something has to be subscribed to hear it.
Leaving that to the client connections — which is where this started — makes the answer only as good as
whoever happens to be attached: the subscription goes with the browser tab, so a tab closed between a
request's `busy` and its `idle` left the kernel reported busy for the rest of its life, and a kernel
nothing had ever opened was never reported as anything at all. Those are precisely the kernels the panel
exists to show.

So the server subscribes for itself, once per kernel, for as long as the kernel runs. iopub is a
broadcast: another subscriber costs the kernel nothing and misses nothing, whether a client is attached
or not. jupyter_server answers the same question the same way.
*/
func watchKernelActivity(ctx context.Context, km KernelManager) {
	// Dialling waits for the kernel to bind its ports, which is why this runs on a goroutine of its own
	// rather than being something StartKernelManager waits out.
	socket := km.ConnectionInfo.ConnectIopub(ctx)
	defer socket.Close()

	for {
		zmsg, err := socket.Recv()
		if err != nil {
			// Either the kernel has gone or this was cancelled because it was stopped, and there is
			// nothing further to hear from it: a loop that logged and carried on would spin on a socket
			// that will never answer again.
			if ctx.Err() == nil {
				log.Debug().Msgf("stopped watching kernel %s: %v", km.KernelId, err)
			}
			return
		}
		recordKernelActivity(km.KernelId, km.Session.PublishedState(zmsg))
	}
}

// stopWatchingKernel ends the watch on a kernel that has been stopped. Nothing to stop for a manager
// that never started one, which is any manager built outside StartKernelManager.
func stopWatchingKernel(km KernelManager) {
	if km.stopWatching != nil {
		km.stopWatching()
	}
}
