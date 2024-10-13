package kernel

import (
	"log"
	"path/filepath"
	"sync"
	"zasper_go/models"

	"github.com/google/uuid"
)

var ZasperPendingKernels map[string]KernelManager
var ZasperActiveKernels map[string]KernelManager

func SetUpStateKernels() map[string]KernelManager {
	return make(map[string]KernelManager)
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
	log.Println(km, kernel_name, kernel_id)

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
	connectionDir := ""
	kernelName = "python3" // note this is default kernel Name
	km := KernelManager{
		ConnectionFile: filepath.Join(connectionDir, "kernel.json"),
		KernelName:     kernelName,
		KernelId:       kernelId,
		CachePorts:     true,
	}
	km.ConnectionInfo.Transport = "tcp"
	km.ConnectionInfo.IP = "127.0.0.1"
	km.Session = getSession()
	log.Println("session is", km.Session)
	return km, kernelName, kernelId
}

func addKernelWhenReady() {

}

func NotifyConnect() {

}
