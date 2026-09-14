package kernel

import (
	"context"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/zasper-io/zasper/internal/kernel/provisioner"
	"github.com/zasper-io/zasper/internal/kernelspec"

	"github.com/rs/zerolog/log"
)

type KernelManager struct {
	ConnectionFile string
	KernelName     string
	Provisioner    provisioner.LocalProvisioner

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

	KernelId string

	// The folder the kernel starts in, and variables set for it on top of the kernelspec's.
	Dir string
	Env map[string]string

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

	kernelCmd, kw, err := km.asyncPrestartKernel(kernelName)
	if err != nil {
		return err
	}
	return km.LaunchKernel(kernelCmd, kw)
}

func (km *KernelManager) StopKernel(kernelId string) error {
	shutdownProcess(*km)

	// The kernel has let go of its five ports, so they go back on offer. Without this the
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

	return nil
}

func (km *KernelManager) asyncPrestartKernel(kernelName string) ([]string, map[string]interface{}, error) {
	// Before any port is taken or connection file written, so a missing or broken spec leaves nothing
	// behind to clean up.
	spec, err := kernelspec.GetKernelSpec(km.KernelName)
	if err != nil {
		return nil, nil, err
	}

	km.Provisioner = provisioner.LocalProvisioner{
		KernelId:   km.KernelId,
		Kernelspec: spec,
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
	// Every one of them, or none: a connection file with a 0 in it launches a kernel that binds a port
	// the client will never dial, and the failure surfaces much later as a kernel that starts and then
	// says nothing.
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
	log.Debug().Msgf("km.ConnectionFile : %+v", km.ConnectionFile)

	if err := km.writeConnectionFile(km.ConnectionFile); err != nil {
		return nil, err
	}

	kernelCmd := km.formatKernelCmd()
	log.Debug().Msgf("kernel cmd is %s", kernelCmd)

	processEnv := kernelEnv(os.Environ(), km.Provisioner.Kernelspec.Env)
	// A kernel that honours it, as ipykernel does, exits once this process has gone, so a server that
	// crashes does not leave its kernels running. A Windows kernel reads it as a handle, not a pid.
	if runtime.GOOS != "windows" {
		processEnv = append(processEnv, "JPY_PARENT_PID="+strconv.Itoa(os.Getpid()))
	}
	// Appended as they are rather than through kernelEnv, which would expand a `$` in a notebook's path.
	for _, name := range slices.Sorted(maps.Keys(km.Env)) {
		processEnv = append(processEnv, name+"="+km.Env[name])
	}

	env := make(map[string]interface{})
	env["cmd"] = kernelCmd
	env["env"] = processEnv
	env["cwd"] = km.Dir
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
		cmd[0] = getPython()
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

// getPython answers the bare Python on PATH, looked up rather than run.
func getPython() string {
	if _, err := exec.LookPath("python"); err == nil {
		return "python"
	}
	return "python3"
}
