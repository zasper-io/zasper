package kernel

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/models"
	"github.com/zasper-io/zasper/internal/store"

	"github.com/google/uuid"

	"github.com/rs/zerolog/log"
)

// The running kernels. Starting or stopping one launches or signals a process, which is never done under
// the store's lock; the lock is for claiming a kernel, so that only one caller acts on it.
var kernels store.Map[string, KernelManager]

// SetUpStateKernels empties the store, for a server that is starting up.
func SetUpStateKernels() {
	kernels.Clear()
}

// ActiveKernel answers the manager for a running kernel, as a copy: managers are held by value.
func ActiveKernel(kernelId string) (KernelManager, bool) {
	return kernels.Get(kernelId)
}

func setActiveKernel(kernelId string, km KernelManager) {
	kernels.Set(kernelId, km)
}

// updateActiveKernel changes a stored manager, and does nothing for a kernel that is not running.
func updateActiveKernel(kernelId string, change func(*KernelManager)) {
	kernels.Update(kernelId, change)
}

// RFC 3339, because the browser is what reads it: `time.Time.String()` is Go's own format and
// `new Date` cannot parse it.
func activityStamp() string {
	return time.Now().UTC().Format(time.RFC3339)
}

/*
recordKernelActivity notes that a kernel has just said something, and what it said it was doing.

An empty state leaves the last one standing: only a status message says what a kernel is doing, and
every other message is activity and nothing else. Called from the kernel's activity watcher, which is
the only thing that hears either — see kernel_activity.go.
*/
func recordKernelActivity(kernelId string, state string) {
	stamp := activityStamp()
	updateActiveKernel(kernelId, func(km *KernelManager) {
		km.LastActivity = stamp
		if state != "" {
			km.ExecutionState = state
		}
	})
}

// SetKernelConnections records how many clients are attached to a kernel. Called by the websocket
// layer, which owns those connections; counting them from here would mean importing it, and it
// already imports this package.
func SetKernelConnections(kernelId string, count int) {
	updateActiveKernel(kernelId, func(km *KernelManager) {
		km.Connections = count
	})
}

// removeActiveKernel takes a kernel out and reports whether this call took it, so that two callers do
// not both signal its pid, which by the second time may belong to another process.
func removeActiveKernel(kernelId string) (KernelManager, bool) {
	return kernels.Take(kernelId)
}

func activeKernels() []KernelManager {
	return kernels.Values()
}

// disconnectHandlers are notified when a kernel stops. The websocket layer
// registers one to tear down the client connections attached to that kernel; it
// cannot be called from here directly without an import cycle.
var disconnectHandlers []func(kernelId string)

// OnKernelDisconnect registers a callback invoked whenever a kernel stops.
func OnKernelDisconnect(handler func(kernelId string)) {
	disconnectHandlers = append(disconnectHandlers, handler)
}

func NotifyDisconnect(kernelId string) {
	for _, handler := range disconnectHandlers {
		handler(kernelId)
	}
}

// ErrKernelNotFound is returned when a kernel id does not belong to a running kernel.
var ErrKernelNotFound = errors.New("kernel not found")

func KillKernelById(kernelId string) error {
	// Taken out first, and signalled only by whoever took it out.
	km, ok := removeActiveKernel(kernelId)
	if !ok {
		return fmt.Errorf("%w: %s", ErrKernelNotFound, kernelId)
	}

	NotifyDisconnect(km.KernelId)
	stopWatchingKernel(km)
	if err := km.StopKernel(kernelId); err != nil {
		log.Error().Msgf("Error stopping kernel %s: %v", kernelId, err)
	}

	// The session outlives its kernel otherwise, so /api/sessions would keep
	// advertising a kernel that is gone.
	for _, sessionId := range core.DeleteSessionsForKernel(kernelId) {
		log.Debug().Msgf("removed session %s attached to kernel %s", sessionId, kernelId)
	}

	return nil
}

// listKernels answers from one snapshot rather than looking each kernel up in turn, so a kernel that
// stops while the list is being built is either in it or not, and never in it as an empty entry.
func listKernels() ([]models.KernelModel, error) {
	running := activeKernels()

	listed := make([]models.KernelModel, 0, len(running))
	for _, km := range running {
		listed = append(listed, kernelModel(km))
	}
	return listed, nil
}

func getKernel(kernelId string) (models.KernelModel, error) {
	km, ok := ActiveKernel(kernelId)
	if !ok {
		// Without the check this answered 200 and a model with nothing in it but the id the caller
		// already had.
		return models.KernelModel{}, fmt.Errorf("%w: %s", ErrKernelNotFound, kernelId)
	}
	return kernelModel(km), nil
}

func kernelModel(km KernelManager) models.KernelModel {
	return models.KernelModel{
		Id:             km.KernelId,
		Name:           km.KernelName,
		LastActivity:   km.LastActivity,
		ExecutionState: km.ExecutionState,
		Connections:    km.Connections,
	}
}

func interruptKernel(kernelId string) error {
	km, ok := ActiveKernel(kernelId)
	if !ok {
		// Not merely a wrong answer: the zero KernelManager has pid 0, and SIGINT to pid 0 goes to
		// every process in this process group, the server included.
		return fmt.Errorf("%w: %s", ErrKernelNotFound, kernelId)
	}

	// The messaging protocol's alternative to SIGINT, for a kernelspec that asks for it.
	if km.Provisioner.Kernelspec.InterruptMode == "message" {
		return km.sendControlRequest("interrupt_request", map[string]interface{}{})
	}

	process := km.Provisioner.Process
	if process == nil {
		return fmt.Errorf("kernel %s has no process to interrupt", kernelId)
	}
	return process.Interrupt()
}

// StartKernelManager starts a kernel in dir, with env set for it on top of its kernelspec's own.
func StartKernelManager(dir string, kernelName string, env map[string]string) (string, error) {
	kernelId := uuid.New().String()

	km := createKernelManager(kernelName, kernelId)
	km.Dir = dir
	km.Env = env

	err := km.StartKernel(kernelName)

	if err != nil {
		return "", err
	}

	// `starting` is Jupyter's own name for a kernel that is up and has published nothing yet, which is
	// what this is for the moment: the watcher below is dialling, and the state changes on the kernel's
	// first status message.
	km.ExecutionState = "starting"
	km.LastActivity = activityStamp()

	// Not the request's context: this outlives the request that started the kernel by as long as the
	// kernel runs, and is cancelled by whichever call stops it.
	watching, stopWatching := context.WithCancel(context.Background())
	km.stopWatching = stopWatching

	// Stored once the kernel is up, and outside the lock: launching a process takes as long as it takes,
	// and nothing can look this kernel up before it exists.
	setActiveKernel(kernelId, km)

	// Started after the store entry, because what it records is dropped for a kernel that is not in it.
	go watchKernelActivity(watching, km)
	go watchForExit(km)

	return kernelId, nil
}

func StopKernelManager(kernelId string) error {
	// Taken out first, so two requests stopping the same kernel do not both shut it down and both be
	// told it worked.
	km, ok := removeActiveKernel(kernelId)
	if !ok {
		return fmt.Errorf("%w: %s", ErrKernelNotFound, kernelId)
	}

	NotifyDisconnect(kernelId)
	stopWatchingKernel(km)

	if err := km.StopKernel(kernelId); err != nil {
		// The kernel is unusable either way, and it is already out of the store.
		log.Error().Msgf("Error stopping kernel %s: %v", kernelId, err)
	}

	return nil
}

func createKernelManager(kernelName string, kernelId string) KernelManager {
	// The full id, not kernelId[:6]: 24 bits collides, and it panicked outright on an id shorter
	// than six characters.
	connectionFile := filepath.Join(runtimeDir(), "kernel-"+kernelId+".json")
	km := KernelManager{
		ConnectionFile: connectionFile,
		KernelName:     kernelName,
		KernelId:       kernelId,
	}
	km.ConnectionInfo.Transport = "tcp"
	km.ConnectionInfo.IP = "127.0.0.1"
	km.Session = getSession()
	return km
}
