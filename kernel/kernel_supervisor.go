package kernel

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"

	"github.com/go-zeromq/zmq4"
	"github.com/zasper-io/zasper/models"

	"github.com/google/uuid"

	"github.com/rs/zerolog/log"
)

var ZasperPendingKernels map[string]KernelManager
var ZasperActiveKernels map[string]KernelManager

func SetUpStateKernels() map[string]KernelManager {
	return make(map[string]KernelManager)
}

func Cleanup() {
	for _, km := range ZasperActiveKernels {
		killKernel(km.Provisioner.Pid)
	}
}

func killKernel(pid int) {

	// Get the process by PID
	process, err := os.FindProcess(pid)
	if err != nil {
		fmt.Printf("Error finding process: %v\n", err)
		return
	}

	// Attempt to kill the process
	err = process.Kill()
	if err != nil {
		if err == syscall.ESRCH {
			fmt.Println("No such process.")
		} else if err == syscall.EPERM {
			fmt.Println("Permission denied.")
		} else {
			fmt.Printf("Error killing process: %v\n", err)
		}
		return
	}

	fmt.Printf("Process %d killed successfully.\n", pid)
}

func NotifyDisconnect(kernelId string) {

}

func RemoveRestartCallback() {

}

func StartBuffering(kernelId, sessionKey string, channels map[string]zmq4.Socket) {

}

func listKernels() []models.KernelModel {
	kernelIds := listKernelIds()

	kernels := []models.KernelModel{}

	for _, kernelId := range kernelIds {
		kernels = append(kernels, getKernel(kernelId))
	}
	return kernels
}

func getKernel(kernelId string) models.KernelModel {
	km := ZasperActiveKernels[kernelId]
	kernel := models.KernelModel{
		Id:             kernelId,
		Name:           km.KernelName,
		LastActivity:   km.LastActivity,
		ExecutionState: km.ExecutionState,
		Connections:    km.Connections,
	}
	return kernel
}

func listKernelIds() []string {
	keys := make([]string, 0, len(ZasperActiveKernels))
	for key := range ZasperActiveKernels {
		keys = append(keys, key)
	}
	return keys
}

func StartKernelManager(kernelPath string, kernelName string, env map[string]string) string {
	kernelId := uuid.New().String()

	km, kernel_name, kernel_id := createKernelManager(kernelName, kernelId)
	log.Debug().Msgf("%v | %v | %v ", km, kernel_name, kernel_id)

	km.StartKernel(kernelName)

	// task := addKernelWhenReady()
	ZasperActiveKernels[kernelId] = km

	return kernelId
}

func finishKernelStart(wg *sync.WaitGroup) {
	wg.Done()
}

func CwdForPath(path string) string {
	return path
}

func createKernelManager(kernelName string, kernelId string) (KernelManager, string, string) {
	connectionDir := "/tmp/"
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
	log.Info().Msgf("session is %v", km.Session)
	return km, kernelName, kernelId
}

func addKernelWhenReady() {

}

func NotifyConnect() {

}
