package kernel

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/google/uuid"

	"github.com/zasper-io/zasper/internal/models"
	"github.com/zasper-io/zasper/internal/store"
)

// The running kernels. Starting or stopping one launches or signals a process, which is never done under
// the store's lock; the lock is for claiming a kernel, so that only one caller acts on it.
var kernels store.Map[string, *KernelManager]

// SetUpStateKernels empties the store, for a server that is starting up.
func SetUpStateKernels() {
	kernels.Clear()
}

// ActiveKernel answers the manager for a running kernel.
func ActiveKernel(kernelId string) (*KernelManager, bool) {
	return kernels.Get(kernelId)
}

func setActiveKernel(kernelId string, km *KernelManager) {
	kernels.Set(kernelId, km)
}

// removeActiveKernel takes a kernel out and reports whether this call took it, so that two callers do
// not both signal its pid, which by the second time may belong to another process.
func removeActiveKernel(kernelId string) (*KernelManager, bool) {
	return kernels.Take(kernelId)
}

func activeKernels() []*KernelManager {
	return kernels.Values()
}

// recordKernelActivity notes what a running kernel has just said. Nothing is recorded for a kernel that
// has stopped.
func recordKernelActivity(kernelId string, state string) {
	if km, ok := ActiveKernel(kernelId); ok {
		km.recordActivity(state)
	}
}

// SetKernelConnections records how many clients are attached to a running kernel. The websocket layer owns
// those connections and cannot be imported from here, so it reports them.
func SetKernelConnections(kernelId string, count int) {
	if km, ok := ActiveKernel(kernelId); ok {
		km.setConnections(count)
	}
}

// disconnectHandlers are told when a kernel stops, by the packages holding what depends on it — its
// sessions and its client sockets — which this package cannot import.
var disconnectHandlers []func(kernelId string)

// OnKernelDisconnect registers a handler, called in registration order whenever a kernel stops.
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
	km, ok := removeActiveKernel(kernelId)
	if !ok {
		return fmt.Errorf("%w: %s", ErrKernelNotFound, kernelId)
	}

	NotifyDisconnect(kernelId)
	stopWatchingKernel(km)
	km.stop()
	return nil
}

// listKernels answers from one snapshot, so a kernel that stops while the list is built is either in it
// or not.
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
		return models.KernelModel{}, fmt.Errorf("%w: %s", ErrKernelNotFound, kernelId)
	}
	return kernelModel(km), nil
}

func kernelModel(km *KernelManager) models.KernelModel {
	lastActivity, executionState, connections := km.Status()
	return models.KernelModel{
		Id:             km.KernelId,
		Name:           km.KernelName,
		LastActivity:   lastActivity,
		ExecutionState: executionState,
		Connections:    connections,
	}
}

func interruptKernel(kernelId string) error {
	km, ok := ActiveKernel(kernelId)
	if !ok {
		return fmt.Errorf("%w: %s", ErrKernelNotFound, kernelId)
	}

	// The messaging protocol's alternative to SIGINT, for a kernelspec that asks for it.
	if km.Spec.InterruptMode == "message" {
		return km.sendControlRequest("interrupt_request", map[string]interface{}{})
	}

	// Refused rather than signalled: SIGINT to a zero pid reaches every process in this process group,
	// the server included.
	if km.Process == nil {
		return fmt.Errorf("kernel %s has no process to interrupt", kernelId)
	}
	return km.Process.Interrupt()
}

// StartKernelManager starts a kernel in dir, with env set for it on top of its kernelspec's own, and
// answers its id.
func StartKernelManager(dir string, kernelName string, env map[string]string) (string, error) {
	kernelId := uuid.New().String()

	km := newKernelManager(kernelName, kernelId)
	km.Dir = dir
	km.Env = env
	if err := km.start(); err != nil {
		return "", err
	}

	// Jupyter's name for a kernel that is up and has published nothing yet; its first status message
	// replaces it.
	km.recordActivity("starting")

	// Not the request's context: the watch lasts as long as the kernel, and whatever stops it cancels it.
	watching, stopWatching := context.WithCancel(context.Background())
	km.stopWatching = stopWatching

	// Stored before the watchers start, because activity for a kernel that is not in the store is dropped.
	setActiveKernel(kernelId, km)
	go watchKernelActivity(watching, km)
	go watchForExit(km)

	return kernelId, nil
}

func StopKernelManager(kernelId string) error {
	km, ok := removeActiveKernel(kernelId)
	if !ok {
		return fmt.Errorf("%w: %s", ErrKernelNotFound, kernelId)
	}

	NotifyDisconnect(kernelId)
	stopWatchingKernel(km)
	km.stop()
	return nil
}

func newKernelManager(kernelName string, kernelId string) *KernelManager {
	km := &KernelManager{
		KernelId:   kernelId,
		KernelName: kernelName,
		// The whole id: a prefix of it collides.
		ConnectionFile: filepath.Join(runtimeDir(), "kernel-"+kernelId+".json"),
		Session:        getSession(),
	}
	km.ConnectionInfo.Transport = "tcp"
	km.ConnectionInfo.IP = "127.0.0.1"
	return km
}
