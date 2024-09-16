package kernel

var ZasperPendingKernels map[string]KernelManager
var ZasperActiveKernels map[string]KernelManager

func SetUpStateKernels() map[string]KernelManager {
	return make(map[string]KernelManager)
}
