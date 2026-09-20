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
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/kernel/launcher"
	"github.com/zasper-io/zasper/internal/kernelspec"
)

// KernelManager is one running kernel. The store holds it by pointer, and everything but its activity is
// set before it is stored and not changed afterwards.
type KernelManager struct {
	KernelId       string
	KernelName     string
	ConnectionFile string

	// The folder the kernel starts in, and variables set for it on top of the kernelspec's.
	Dir string
	Env map[string]string

	Spec           kernelspec.KernelSpecJsonData
	Session        KernelSession
	ConnectionInfo Connection
	// The launched process, nil until start has run.
	Process *launcher.Process

	// Stops the activity watcher. Held here so that whoever takes the kernel out of the store can stop it.
	stopWatching context.CancelFunc

	activity activity
}

// activity is what /api/kernels reports about a running kernel. The activity watcher and the websocket
// layer write it while the API reads it, so it has a lock of its own.
type activity struct {
	mu             sync.Mutex
	lastActivity   string
	executionState string
	connections    int
}

// RFC 3339, because the browser reads it: `new Date` cannot parse Go's own time format.
func activityStamp() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// recordActivity notes that the kernel has just said something. An empty state leaves the last one
// standing: only a status message says what a kernel is doing.
func (km *KernelManager) recordActivity(state string) {
	km.activity.mu.Lock()
	defer km.activity.mu.Unlock()

	km.activity.lastActivity = activityStamp()
	if state != "" {
		km.activity.executionState = state
	}
}

func (km *KernelManager) setConnections(count int) {
	km.activity.mu.Lock()
	defer km.activity.mu.Unlock()

	km.activity.connections = count
}

// Status answers when the kernel last said anything, what it last said it was doing, and how many clients
// are attached to it.
func (km *KernelManager) Status() (lastActivity, executionState string, connections int) {
	km.activity.mu.Lock()
	defer km.activity.mu.Unlock()

	return km.activity.lastActivity, km.activity.executionState, km.activity.connections
}

/*
start launches the kernel: it reads the kernelspec, takes five ports, writes the connection file and
starts the process. The spec is read first, so that a kernel that cannot start leaves nothing to clean up,
and a launch that fails gives back its ports and its file.
*/
func (km *KernelManager) start(specs *kernelspec.Catalog) error {
	spec, err := specs.Spec(km.KernelName)
	if err != nil {
		return err
	}
	if len(spec.Argv) == 0 {
		return fmt.Errorf("kernelspec %s has no command to run", km.KernelName)
	}
	km.Spec = spec

	// Every port or none: a connection file with a 0 in it starts a kernel on a port no client dials.
	for _, port := range km.ports() {
		assigned, err := findAvailablePort()
		if err != nil {
			km.releasePorts()
			return fmt.Errorf("no port for the kernel's channels: %w", err)
		}
		*port = assigned
	}
	if err := km.writeConnectionFile(km.ConnectionFile); err != nil {
		km.releasePorts()
		return err
	}

	process, err := launcher.Launch(km.launchSpec())
	if err != nil {
		km.releasePorts()
		removeConnectionFile(km.ConnectionFile)
		return err
	}
	km.Process = process
	log.Debug().Str("kernel", km.KernelId).Int("pid", process.Pid).Msg("kernel launched")
	return nil
}

// stop shuts the process down, gives back its ports and deletes its connection file, which carries the
// kernel's signing key.
func (km *KernelManager) stop() {
	shutdownProcess(km)
	km.releasePorts()
	removeConnectionFile(km.ConnectionFile)
}

func (km *KernelManager) ports() []*int {
	info := &km.ConnectionInfo
	return []*int{&info.ShellPort, &info.IopubPort, &info.StdinPort, &info.HbPort, &info.ControlPort}
}

func (km *KernelManager) releasePorts() {
	for _, port := range km.ports() {
		if *port != 0 {
			releasePort(*port)
		}
	}
}

// launchSpec is the command line, environment and folder the kernel is started with.
func (km *KernelManager) launchSpec() launcher.Spec {
	env := kernelEnv(os.Environ(), km.Spec.Env)
	// ipykernel exits once the process JPY_PARENT_PID names has gone, so a server that crashes leaves no
	// kernels running. A Windows kernel reads it as a handle, not a pid.
	if runtime.GOOS != "windows" {
		env = append(env, "JPY_PARENT_PID="+strconv.Itoa(os.Getpid()))
	}
	// Appended as they are rather than through kernelEnv, which would expand a `$` in a notebook's path.
	for _, name := range slices.Sorted(maps.Keys(km.Env)) {
		env = append(env, name+"="+km.Env[name])
	}
	return launcher.Spec{Argv: km.argv(), Env: env, Dir: km.Dir}
}

var barePython = regexp.MustCompile(`^python(\d+(\.\d+)?)?$`)

/*
argv is the kernelspec's command line with the connection file filled in. A bare python is the Python the
spec was installed by, the nearest Zasper has to the sys.executable jupyter_client uses; PATH's is the
guess only when that cannot be told.
*/
func (km *KernelManager) argv() []string {
	cmd := slices.Clone(km.Spec.Argv)
	for i, arg := range cmd {
		if arg == "{connection_file}" {
			cmd[i] = km.ConnectionFile
		}
	}
	if len(cmd) == 0 || !barePython.MatchString(cmd[0]) {
		return cmd
	}
	if interpreter := kernelspec.ResolvedInterpreter(km.Spec); interpreter != "" {
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
