package kernel

import (
	"fmt"
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

func (km *KernelManager) StartKernel(kernelName string) error {
	log.Debug().Msg("kernel manager is launching a kernel")

	km.AttemptedStart = true

	kernelCmd, kw, err := km.asyncPrestartKernel(kernelName)
	if err != nil {
		return err
	}
	if err := km.LaunchKernel(kernelCmd, kw); err != nil {
		return err
	}
	km.Ready = true
	return nil
}

func (km *KernelManager) StopKernel(kernelId string) error {
	km.ShuttingDown = true
	// The kernel is about to let go of its five ports, so they go back on offer. Without this the
	// tracking list only grows, and a long-lived server starts refusing to allocate.
	for _, port := range []int{
		km.ConnectionInfo.ShellPort,
		km.ConnectionInfo.IopubPort,
		km.ConnectionInfo.StdinPort,
		km.ConnectionInfo.HbPort,
		km.ConnectionInfo.ControlPort,
	} {
		releasePort(port)
	}
	return km.Provisioner.ShutdownKernel()
}

func (km *KernelManager) getKernelspec() kernelspec.KernelSpecJsonData {
	return kernelspec.GetKernelSpec(km.KernelName)
}

func (km *KernelManager) asyncPrestartKernel(kernelName string) ([]string, map[string]interface{}, error) {
	km.ShuttingDown = false

	km.Provisioner = provisioner.LocalProvisioner{
		KernelId:    km.KernelId,
		Kernelspec:  km.getKernelspec(),
		PortsCached: false,
	}

	log.Debug().Msgf("kernelspec created is: %v", km.Provisioner.Kernelspec)

	kw, err := km.preLaunch()
	if err != nil {
		return nil, nil, err
	}
	kernelCmd := kw["cmd"].([]string)
	log.Debug().Msgf("kenelName: %s", kernelName)
	return kernelCmd, kw, nil
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

func (km *KernelManager) LaunchKernel(kernelCmd []string, kw map[string]interface{}) error {
	ConnectionInfo, err := km.Provisioner.LaunchKernel(kernelCmd, kw, km.ConnectionFile)
	if err != nil {
		return err
	}
	log.Debug().Msgf("connectionInfo: %s", ConnectionInfo)
	return nil
}

func (km *KernelManager) preLaunch() (map[string]interface{}, error) {

	if km.ConnectionInfo.Transport == "tcp" && !isLocalIP(km.ConnectionInfo.IP) {
		log.Debug().Msg("Can only launch a kernel on a local interface.")
	}
	log.Debug().Msgf("cache ports: %t", km.CachePorts)
	log.Debug().Msgf("km.Provisioner.PortsCached %t", km.Provisioner.PortsCached)

	if km.CachePorts && !km.Provisioner.PortsCached {
		// Every one of them, or none: a connection file with a 0 in it launches a kernel that binds a
		// port the client will never dial, and the failure surfaces much later as a kernel that starts
		// and then says nothing.
		for _, port := range []*int{
			&km.ConnectionInfo.ShellPort,
			&km.ConnectionInfo.IopubPort,
			&km.ConnectionInfo.StdinPort,
			&km.ConnectionInfo.HbPort,
			&km.ConnectionInfo.ControlPort,
		} {
			assigned, err := findAvailablePort()
			if err != nil {
				return nil, fmt.Errorf("no port for the kernel's channels: %w", err)
			}
			*port = assigned
		}
		log.Debug().Msgf("connectionInfo : %+v", km.ConnectionInfo)
	}
	log.Debug().Msgf("km.ConnectionFile : %+v", km.ConnectionFile)

	if err := km.writeConnectionFile(km.ConnectionFile); err != nil {
		return nil, err
	}

	kernelCmd := km.formatKernelCmd()
	log.Debug().Msgf("kernel cmd is %s", kernelCmd)

	env := make(map[string]interface{})
	env["cmd"] = kernelCmd
	env["env"] = os.Environ()
	return env, nil
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
