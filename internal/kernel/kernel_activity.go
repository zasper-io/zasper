package kernel

import (
	"context"

	"github.com/rs/zerolog/log"
)

/*
watchKernelActivity subscribes to a kernel's iopub for as long as the kernel runs, so /api/kernels can say
what a kernel is doing when no browser is attached to it. iopub is a broadcast, so another subscriber
costs the kernel nothing; jupyter_server keeps the same watch.
*/
func watchKernelActivity(ctx context.Context, km *KernelManager) {
	// Dialling waits for the kernel to bind its ports, which is why this runs on a goroutine of its own.
	socket := km.ConnectionInfo.ConnectIopub(ctx)
	defer socket.Close()

	for {
		zmsg, err := socket.Recv()
		if err != nil {
			// The kernel has gone, or the watch was cancelled: either way there is nothing more to hear.
			if ctx.Err() == nil {
				log.Debug().Msgf("stopped watching kernel %s: %v", km.KernelId, err)
			}
			return
		}
		km.recordActivity(km.Session.PublishedState(zmsg))
	}
}

// stopWatchingKernel ends the watch on a stopped kernel. A manager built outside Kernels.Start never
// started one.
func stopWatchingKernel(km *KernelManager) {
	if km.stopWatching != nil {
		km.stopWatching()
	}
}
