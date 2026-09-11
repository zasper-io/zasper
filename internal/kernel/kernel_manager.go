package kernel

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"slices"
	"sort"
	"strings"

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

	// What /api/kernels reports about a kernel nobody in a given window is attached to: when it last
	// said anything, whether it is busy, and how many clients are on it. Written by the supervisor and
	// not from here — a stored manager is held by value, so these are set by putting a changed copy
	// back rather than by touching the one a caller happens to hold. See recordKernelActivity.
	LastActivity   string
	ExecutionState string
	Connections    int

	// Stops the activity watcher that writes the two fields above. Unexported and held here rather than
	// in a map of its own, so that whoever takes a kernel out of the store has what it takes to stop
	// listening to it in the same hand.
	stopWatching context.CancelFunc

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

	// The file carries this kernel's signing key and is of no use once the kernel is gone.
	removeConnectionFile(km.ConnectionFile)

	return km.Provisioner.ShutdownKernel()
}

func (km *KernelManager) asyncPrestartKernel(kernelName string) ([]string, map[string]interface{}, error) {
	km.ShuttingDown = false

	// Before any port is taken or connection file written, so a missing or broken spec leaves nothing
	// behind to clean up.
	spec, err := kernelspec.GetKernelSpec(km.KernelName)
	if err != nil {
		return nil, nil, err
	}

	km.Provisioner = provisioner.LocalProvisioner{
		KernelId:    km.KernelId,
		Kernelspec:  spec,
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
	env["env"] = kernelEnv(os.Environ(), km.Provisioner.Kernelspec.Env)
	return env, nil
}

var barePython = regexp.MustCompile(`^python(\d+(\.\d+)?)?$`)

func (km *KernelManager) formatKernelCmd() []string {
	// A copy of the spec the provisioner holds, not a second read from disk: the launcher rewrites
	// {connection_file} in place.
	cmd := slices.Clone(km.Provisioner.Kernelspec.Argv)
	if len(cmd) == 0 || !barePython.MatchString(cmd[0]) {
		return cmd
	}
	// jupyter_client runs a bare python with its own sys.executable; the nearest Zasper has is the
	// Python the spec was installed by. PATH's is the guess only when that cannot be told.
	if interpreter := kernelspec.Interpreter(km.Provisioner.Kernelspec.ResourceDir); interpreter != "" {
		cmd[0] = interpreter
	} else if cmd[0] == "python3" || cmd[0] == "python" {
		pythonVersion, _ := getPython()
		cmd[0] = pythonVersion
	}
	return cmd
}

// string.Template's pattern, which jupyter_client uses on a spec's env: $$, ${name} and $name.
var envReference = regexp.MustCompile(`\$(?:(\$)|\{([_A-Za-z][_A-Za-z0-9]*)\}|([_A-Za-z][_A-Za-z0-9]*))`)

/*
kernelEnv is the server's environment with the kernelspec's `env` laid over it. Each value's references
are filled from the server's environment and a name it does not have is left as written, which is
jupyter_client's safe_substitute. Appended rather than replaced, because os/exec keeps the last of
duplicate keys.
*/
func kernelEnv(base []string, specEnv map[string]string) []string {
	lookup := make(map[string]string, len(base))
	for _, entry := range base {
		if name, value, ok := strings.Cut(entry, "="); ok {
			lookup[name] = value
		}
	}

	names := make([]string, 0, len(specEnv))
	for name := range specEnv {
		names = append(names, name)
	}
	sort.Strings(names)

	env := slices.Clone(base)
	for _, name := range names {
		value := envReference.ReplaceAllStringFunc(specEnv[name], func(reference string) string {
			groups := envReference.FindStringSubmatch(reference)
			if groups[1] != "" {
				return "$"
			}
			if resolved, ok := lookup[groups[2]+groups[3]]; ok {
				return resolved
			}
			return reference
		})
		env = append(env, name+"="+value)
	}
	return env
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
