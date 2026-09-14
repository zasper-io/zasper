package kernel

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/google/uuid"

	"github.com/zasper-io/zasper/internal/kernelspec"
	"github.com/zasper-io/zasper/internal/models"
	"github.com/zasper-io/zasper/internal/store"
)

// Kernels are the kernels a server runs. Starting or stopping one launches or signals a process, which is
// never done under the store's lock; the lock is for claiming a kernel, so that only one caller acts on it.
type Kernels struct {
	specs   *kernelspec.Catalog
	running store.Map[string, *KernelManager]
	// Told when a kernel stops, by what depends on it and cannot be imported from here: its sessions and
	// its client sockets. Registered before the server serves anything.
	disconnectHandlers []func(kernelId string)
}

// New starts kernels from the kernelspecs in specs.
func New(specs *kernelspec.Catalog) *Kernels {
	return &Kernels{specs: specs}
}

// Get answers the manager for a running kernel.
func (k *Kernels) Get(kernelId string) (*KernelManager, bool) {
	return k.running.Get(kernelId)
}

// take takes a kernel out and reports whether this call took it, so that two callers do not both signal
// its pid, which by the second time may belong to another process.
func (k *Kernels) take(kernelId string) (*KernelManager, bool) {
	return k.running.Take(kernelId)
}

// SetConnections records how many clients are attached to a running kernel. The websocket layer owns
// those connections and cannot be imported from here, so it reports them.
func (k *Kernels) SetConnections(kernelId string, count int) {
	if km, ok := k.Get(kernelId); ok {
		km.setConnections(count)
	}
}

// OnDisconnect registers a handler, called in registration order whenever a kernel stops.
func (k *Kernels) OnDisconnect(handler func(kernelId string)) {
	k.disconnectHandlers = append(k.disconnectHandlers, handler)
}

func (k *Kernels) notifyDisconnect(kernelId string) {
	for _, handler := range k.disconnectHandlers {
		handler(kernelId)
	}
}

// ErrKernelNotFound is returned when a kernel id does not belong to a running kernel.
var ErrKernelNotFound = errors.New("kernel not found")

// Start starts a kernel in dir, with env set for it on top of its kernelspec's own, and answers its id.
func (k *Kernels) Start(dir string, kernelName string, env map[string]string) (string, error) {
	kernelId := uuid.New().String()

	km := newKernelManager(kernelName, kernelId)
	km.Dir = dir
	km.Env = env
	if err := km.start(k.specs); err != nil {
		return "", err
	}

	// Jupyter's name for a kernel that is up and has published nothing yet; its first status message
	// replaces it.
	km.recordActivity("starting")

	// Not the request's context: the watch lasts as long as the kernel, and whatever stops it cancels it.
	watching, stopWatching := context.WithCancel(context.Background())
	km.stopWatching = stopWatching

	k.running.Set(kernelId, km)
	go watchKernelActivity(watching, km)
	go k.watchForExit(km)

	return kernelId, nil
}

// Stop stops a running kernel, and tells what depended on it.
func (k *Kernels) Stop(kernelId string) error {
	km, ok := k.take(kernelId)
	if !ok {
		return fmt.Errorf("%w: %s", ErrKernelNotFound, kernelId)
	}

	k.notifyDisconnect(kernelId)
	stopWatchingKernel(km)
	km.stop()
	return nil
}

// list answers from one snapshot, so a kernel that stops while the list is built is either in it or not.
func (k *Kernels) list() []models.KernelModel {
	running := k.running.Values()

	listed := make([]models.KernelModel, 0, len(running))
	for _, km := range running {
		listed = append(listed, kernelModel(km))
	}
	return listed
}

func (k *Kernels) model(kernelId string) (models.KernelModel, error) {
	km, ok := k.Get(kernelId)
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

func (k *Kernels) interrupt(kernelId string) error {
	km, ok := k.Get(kernelId)
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
