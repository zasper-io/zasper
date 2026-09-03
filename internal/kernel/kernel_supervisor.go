package kernel

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"

	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/models"

	"github.com/google/uuid"

	"github.com/rs/zerolog/log"
)

/*
The running kernels.

Held behind a lock rather than exported as a map. Every request runs on its own goroutine, and a
kernel is dropped by the session that owned it as well as by a direct kill, so more than one of these
can be here at once — and Go answers a concurrent map write by killing the process, not the request.
The map is unexported so that the lock cannot be forgotten at a call site.

Starting and stopping a kernel means launching or signalling a process, which blocks for as long as it
blocks; none of that happens under the lock. What the lock is for is claiming a kernel, so that only
one caller acts on it — see removeActiveKernel.
*/
var kernels = struct {
	mu sync.RWMutex
	by map[string]KernelManager
}{by: map[string]KernelManager{}}

// SetUpStateKernels empties the store, for a server that is starting up.
func SetUpStateKernels() {
	kernels.mu.Lock()
	defer kernels.mu.Unlock()

	kernels.by = map[string]KernelManager{}
}

// ActiveKernel answers with the manager for a running kernel. A copy, as every read here is: a
// KernelManager is held by value and nothing updates a stored one in place.
func ActiveKernel(kernelId string) (KernelManager, bool) {
	kernels.mu.RLock()
	defer kernels.mu.RUnlock()

	km, ok := kernels.by[kernelId]
	return km, ok
}

func setActiveKernel(kernelId string, km KernelManager) {
	kernels.mu.Lock()
	defer kernels.mu.Unlock()

	kernels.by[kernelId] = km
}

// removeActiveKernel takes a kernel out and says whether it was the one that took it out, so that two
// callers stopping the same kernel do not both go on to signal its pid — which by the second time may
// belong to something else entirely.
func removeActiveKernel(kernelId string) (KernelManager, bool) {
	kernels.mu.Lock()
	defer kernels.mu.Unlock()

	km, ok := kernels.by[kernelId]
	if ok {
		delete(kernels.by, kernelId)
	}
	return km, ok
}

func activeKernels() []KernelManager {
	kernels.mu.RLock()
	defer kernels.mu.RUnlock()

	all := make([]KernelManager, 0, len(kernels.by))
	for _, km := range kernels.by {
		all = append(all, km)
	}
	return all
}

func Cleanup() {
	for _, km := range activeKernels() {
		killKernel(km.Provisioner.Pid)
	}
}

func killKernel(pid int) {
	// A pid of 0 means "every process in this process group" on Unix, which would
	// take the server down with it, so an unknown pid is never signalled.
	if pid <= 0 {
		log.Error().Msgf("Refusing to kill invalid pid %d", pid)
		return
	}

	// Get the process by PID
	process, err := os.FindProcess(pid)
	if err != nil {
		log.Error().Msgf("Error finding process: %v\n", err)
		return
	}

	// Attempt to kill the process
	err = process.Kill()
	if err != nil {
		if err == syscall.ESRCH {
			log.Error().Msgf("No such process.")
		} else if err == syscall.EPERM {
			log.Error().Msgf("Permission denied.")
		} else {
			log.Error().Msgf("Error killing process: %v\n", err)
		}
		return
	}

	log.Debug().Msgf("Process %d killed successfully.\n", pid)
}

func NotifyConnect() {
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
	killKernel(km.Provisioner.Pid)

	// The session outlives its kernel otherwise, so /api/sessions would keep
	// advertising a kernel that is gone.
	for _, sessionId := range core.DeleteSessionsForKernel(kernelId) {
		log.Info().Msgf("Removed session %s attached to kernel %s", sessionId, kernelId)
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

	pid := km.Provisioner.Pid
	if pid <= 0 {
		return fmt.Errorf("refusing to signal invalid pid %d for kernel %s", pid, kernelId)
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("Failed to find process %d: %v", pid, err)
	}

	err = process.Signal(syscall.SIGINT)
	if err != nil {
		return fmt.Errorf("Failed to send SIGINT to process %d: %v", pid, err)
	}

	return nil
}

func StartKernelManager(kernelPath string, kernelName string, env map[string]string) (string, error) {
	kernelId := uuid.New().String()

	km, kernel_name, kernel_id := createKernelManager(kernelName, kernelId)
	log.Debug().Msgf("%v | %v | %v ", km, kernel_name, kernel_id)

	err := km.StartKernel(kernelName)

	if err != nil {
		return "", err
	}

	// Stored once the kernel is up, and outside the lock: launching a process takes as long as it takes,
	// and nothing can look this kernel up before it exists.
	setActiveKernel(kernelId, km)

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

	if err := km.StopKernel(kernelId); err != nil {
		// The kernel is unusable either way, and it is already out of the store.
		log.Error().Msgf("Error stopping kernel %s: %v", kernelId, err)
	}

	return nil
}

func CwdForPath(path string) string {
	return path
}

func createKernelManager(kernelName string, kernelId string) (KernelManager, string, string) {
	connectionDir := os.TempDir()
	connectionFile := filepath.Join(connectionDir, "kernel-"+kernelId[:6]+".json")
	km := KernelManager{
		ConnectionFile: filepath.Join(connectionFile),
		KernelName:     kernelName,
		KernelId:       kernelId,
		CachePorts:     true,
		Kernelspec:     kernelName,
		// todo find from kernelspec dict
	}
	km.ConnectionInfo.Transport = "tcp"
	km.ConnectionInfo.IP = "127.0.0.1"
	km.Session = getSession()
	log.Debug().Msgf("session is %v", km.Session)
	return km, kernelName, kernelId
}
