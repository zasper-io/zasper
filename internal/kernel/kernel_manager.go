package kernel

import (
	"os"
	"os/exec"
	"slices"

	"github.com/zasper-io/zasper/internal/kernel/provisioner"
	"github.com/zasper-io/zasper/internal/kernelspec"

	"github.com/rs/zerolog/log"

	"github.com/go-zeromq/zmq4"
)

type KernelManager struct {
	ConnectionFile string
	OwnsKernel     bool
	ShutdownStatus bool
	AttemptedStart bool
	Ready          bool
	KernelName     string
	ControlSocket  zmq4.Socket
	CachePorts     bool
	Provisioner    provisioner.LocalProvisioner
	Kernelspec     string

	LastActivity   string
	ExecutionState string
	Connections    int

	KernelId     string
	ShuttingDown bool

	Session        KernelSession
	ConnectionInfo Connection
}

/*********************************************************************
**********************************************************************
***                       START KERNEL                            ***
**********************************************************************
*********************************************************************/

func (km *KernelManager) StartKernel(kernelName string) {

	log.Info().Msg("starting kernel")

	km.AttemptedStart = true

	kernelCmd, kw := km.asyncPrestartKernel(kernelName)
	km.asyncLaunchKernel(kernelCmd, kw)
	km.Ready = true
}

func (km *KernelManager) StopKernel(kernelId string) {
	km.ShuttingDown = true
	km.Provisioner.ShutdownKernel()
}

func (km *KernelManager) getKernelspec() kernelspec.KernelSpecJsonData {
	return kernelspec.GetKernelSpec(km.KernelName)
}

func (km *KernelManager) asyncPrestartKernel(kernelName string) ([]string, map[string]interface{}) {
	km.ShuttingDown = false

	km.Provisioner = provisioner.LocalProvisioner{
		KernelId:    km.KernelId,
		Kernelspec:  km.getKernelspec(),
		PortsCached: false,
	}

	log.Debug().Msgf("kernelspec created is: %v", km.Provisioner.Kernelspec)

	kw := km.preLaunch()
	kernelCmd := kw["cmd"].([]string)
	log.Debug().Msgf("kenelName: %s", kernelName)
	return kernelCmd, kw
}

var LOCAL_IPS []string

func isLocalIP(ip string) bool {
	//does `ip` point to this machine?
	return slices.Contains(LOCAL_IPS, ip)
}

/*********************************************************************
**********************************************************************
***                       LAUNCH KERNEL                            ***
**********************************************************************
*********************************************************************/

func (km *KernelManager) asyncLaunchKernel(kernelCmd []string, kw map[string]interface{}) {
	ConnectionInfo, err := km.Provisioner.LaunchKernel(kernelCmd, kw, km.ConnectionFile)
	if err != nil {
		log.Fatal().Msgf("Error launching kernel: %v", err)
		return
	}
	log.Debug().Msgf("connectionInfo: %s", ConnectionInfo)
}

func (km *KernelManager) preLaunch() map[string]interface{} {

	if km.ConnectionInfo.Transport == "tcp" && !isLocalIP(km.ConnectionInfo.IP) {
		log.Debug().Msg("Can only launch a kernel on a local interface.")
	}
	log.Debug().Msgf("cache ports: %t", km.CachePorts)
	log.Debug().Msgf("km.Provisioner.PortsCached %t", km.Provisioner.PortsCached)

	if km.CachePorts && !km.Provisioner.PortsCached {
		km.ConnectionInfo.ShellPort, _ = findAvailablePort()
		km.ConnectionInfo.IopubPort, _ = findAvailablePort()
		km.ConnectionInfo.StdinPort, _ = findAvailablePort()
		km.ConnectionInfo.HbPort, _ = findAvailablePort()
		km.ConnectionInfo.ControlPort, _ = findAvailablePort()
		log.Debug().Msgf("connectionInfo : %+v", km.ConnectionInfo)
	}
	log.Debug().Msgf("km.ConnectionFile : %+v", km.ConnectionFile)

	km.writeConnectionFile(km.ConnectionFile)

	kernelCmd := km.formatKernelCmd()
	log.Debug().Msgf("kernel cmd is %s", kernelCmd)

	env := make(map[string]interface{})
	env["cmd"] = kernelCmd
	env["env"] = os.Environ()
	return env
}

func (km *KernelManager) formatKernelCmd() []string {

	cmd := km.getKernelspec().Argv
	if cmd[0] == "python3" || cmd[0] == "python" {
		pythonVersion, _ := getPython()
		cmd[0] = pythonVersion
	}
	return cmd
}

func getPython() (string, error) {
	// Try running "python --version" or "python3 --version" depending on system
	cmd := exec.Command("python", "--version")
	_, err := cmd.CombinedOutput()
	if err != nil {
		return "python3", err
	}

	return "python", err
}
