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
	// The launched kernel, nil until LaunchKernel has run.
	Process     *launcher.Process
	IP          string
	PortsCached bool
}

func (provisioner *LocalProvisioner) LaunchKernel(kernelCmd []string, kw map[string]interface{}, connFile string) (KernelConnectionInfo, error) {
	process, err := launcher.LaunchKernel(kernelCmd, kw, connFile)
	if err != nil {
		return nil, err
	}

	provisioner.Process = process
	log.Debug().Msgf("kernel launched with pid: %d", process.Pid)
	return provisioner.ConnectionInfo, nil
}
