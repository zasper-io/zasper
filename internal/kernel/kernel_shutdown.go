package kernel

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// A kernel asked to shut down usually exits well within shutdownGrace; one that has not is sent SIGTERM,
// and one that ignores that too is killed.
const (
	controlRequestTimeout = 2 * time.Second
	shutdownGrace         = 5 * time.Second
	terminateGrace        = 2 * time.Second
)

/*
shutdownProcess stops a kernel's process and everything it started, and returns once it has exited.

It asks first, with a shutdown_request on the control channel, so the kernel runs its own cleanup
(atexit handlers, temporary files) before anything is signalled.
*/
func shutdownProcess(km *KernelManager) {
	process := km.Process
	if process == nil {
		return
	}

	if !process.Exited() {
		if err := km.sendControlRequest("shutdown_request", map[string]interface{}{"restart": false}); err != nil {
			log.Debug().Err(err).Str("kernel", km.KernelId).Msg("could not ask the kernel to shut down")
		}
		if !waitForExit(process.Done(), shutdownGrace) {
			log.Debug().Str("kernel", km.KernelId).Msg("kernel did not shut down when asked; terminating it")
			logSignalError(km, process.Terminate())
			if !waitForExit(process.Done(), terminateGrace) {
				logSignalError(km, process.Kill())
				waitForExit(process.Done(), terminateGrace)
			}
		}
	}

	// Whatever the kernel started and left running goes with it.
	logSignalError(km, process.Kill())
}

// sendControlRequest sends one request on a control socket of its own, and gives up after
// controlRequestTimeout: a kernel that is not listening must not hold up whoever asked.
func (km *KernelManager) sendControlRequest(msgType string, content map[string]interface{}) error {
	ctx, cancel := context.WithTimeout(context.Background(), controlRequestTimeout)
	defer cancel()

	socket := km.ConnectionInfo.ConnectControl(ctx)
	defer socket.Close()

	msg := km.Session.MessageFromString(msgType)
	msg.Content = content
	return km.Session.send(socket, msg)
}

func waitForExit(done <-chan struct{}, within time.Duration) bool {
	select {
	case <-done:
		return true
	case <-time.After(within):
		return false
	}
}

func logSignalError(km *KernelManager, err error) {
	if err != nil {
		log.Warn().Err(err).Str("kernel", km.KernelId).Msg("could not signal the kernel")
	}
}

/*
watchForExit notices a kernel that exits without being asked to: a crash, the out-of-memory killer, or
os._exit in a cell. It is treated as a kill would be, so nothing goes on offering a kernel that is gone.
A kernel stopped on purpose has already been taken out of the store by then, and is left alone.
*/
func (k *Kernels) watchForExit(km *KernelManager) {
	process := km.Process
	if process == nil {
		return
	}
	<-process.Done()

	if _, ok := k.take(km.KernelId); !ok {
		return
	}
	log.Warn().Str("kernel", km.KernelId).Int("exit_code", process.ExitCode()).Msg("kernel exited on its own")
	k.recordDeath(km, Death{
		Up:       isClosed(km.Up()),
		ExitCode: process.ExitCode(),
		Signal:   process.Signal(),
		Output:   process.FinalOutput(time.Second),
	})

	k.notifyDisconnect(km.KernelId)
	stopWatchingKernel(km)
	km.stop()
}

// Death is what is known of a kernel that exited on its own, for the notebook it ran to be told why.
type Death struct {
	// Up says whether it had answered at all: one that never did failed to start.
	Up       bool
	ExitCode int
	// The signal that ended it, "" when it exited.
	Signal string
	// Its last lines of output, where a kernel says what went wrong.
	Output string
}

// Message says in a sentence what happened.
func (d Death) Message() string {
	what := "The kernel stopped unexpectedly"
	if !d.Up {
		what = "The kernel stopped before it was ready"
	}
	switch {
	case d.Signal != "":
		return fmt.Sprintf("%s: it was ended by %s.", what, d.Signal)
	case d.ExitCode >= 0:
		return fmt.Sprintf("%s: it exited with code %d.", what, d.ExitCode)
	}
	return what + "."
}

// The deaths kept, newest last: enough for every notebook open at the time to ask.
const keptDeaths = 50

func (k *Kernels) recordDeath(km *KernelManager, death Death) {
	k.deathsMu.Lock()
	defer k.deathsMu.Unlock()
	if k.deaths == nil {
		k.deaths = map[string]Death{}
	}
	k.deaths[km.KernelId] = death
	k.deathOrder = append(k.deathOrder, km.KernelId)
	if len(k.deathOrder) > keptDeaths {
		delete(k.deaths, k.deathOrder[0])
		k.deathOrder = k.deathOrder[1:]
	}
}

// DeathOf answers why a kernel that exited on its own did, when it is one of the last few.
func (k *Kernels) DeathOf(kernelId string) (Death, bool) {
	k.deathsMu.Lock()
	defer k.deathsMu.Unlock()
	death, ok := k.deaths[kernelId]
	return death, ok
}

func isClosed(ch <-chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

// StopAll stops every kernel at once, since each can take a few seconds to shut down cleanly.
func (k *Kernels) StopAll() {
	var stopping sync.WaitGroup
	for _, running := range k.running.Values() {
		km, ok := k.take(running.KernelId)
		if !ok {
			continue
		}
		stopping.Add(1)
		go func() {
			defer stopping.Done()
			stopWatchingKernel(km)
			km.stop()
		}()
	}
	stopping.Wait()
}
