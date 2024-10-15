package kernel

import (
	"github.com/zasper-io/zasper/kernel/launcher"
	"github.com/zasper-io/zasper/kernelspec"

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

func (provisioner *LocalProvisioner) launchKernel(kernelCmd []string, kw map[string]interface{}) KernelConnectionInfo {
	process := launcher.LaunchKernel(kernelCmd, kw)
	provisioner.Pid = process.Pid
	log.Info().Msgf("kernel launched with pid: %d", process.Pid)
	return provisioner.ConnectionInfo
}
