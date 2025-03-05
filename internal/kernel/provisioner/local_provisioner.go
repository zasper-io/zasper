package provisioner

import (
	"github.com/zasper-io/zasper/internal/kernel/launcher"
	"github.com/zasper-io/zasper/internal/kernelspec"

	"github.com/rs/zerolog/log"
)

type KernelConnectionInfo map[string]interface{}

type LocalProvisioner struct {
	Kernelspec     kernelspec.KernelSpecJsonData
	KernelId       string
	ConnectionInfo KernelConnectionInfo
	Process        string
	Exit_future    string
	Pid            int
	Pgid           int
	IP             string
	PortsCached    bool
}

func (provisioner *LocalProvisioner) LaunchKernel(kernelCmd []string, kw map[string]interface{}, connFile string) (KernelConnectionInfo, error) {
	process, err := launcher.LaunchKernel(kernelCmd, kw, connFile)
	if err != nil {
		log.Fatal().Msgf("Error launching kernel: %v", err)
		return nil, err
	}

	provisioner.Pid = process.Pid
	log.Debug().Msgf("kernel launched with pid: %d", process.Pid)
	return provisioner.ConnectionInfo, nil
}

func (provisioner *LocalProvisioner) ShutdownKernel() {
	log.Info().Msgf("Shutting down kernel with pid: %d", provisioner.Pid)
	launcher.ShutdownKernel(provisioner.Pid)
}
