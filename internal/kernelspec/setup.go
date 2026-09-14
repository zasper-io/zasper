package kernelspec

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

/*
Setting up the project's own environment from the launcher's "no kernels" notice: a .venv in the
project with ipykernel installed into it, which the listing then offers as project-venv.

Only ever started by that button. Nothing is installed on launch, nothing into a system or Homebrew
Python, and never with --break-system-packages: a venv is the one place pip is always allowed. One job
at a time, in the background and polled, because it takes as long as the network does.
*/

type SetupStatus struct {
	// idle, running, succeeded or failed.
	State  string `json:"state"`
	Log    string `json:"log"`
	Error  string `json:"error,omitempty"`
	Kernel string `json:"kernel,omitempty"`
}

var ErrSetupRunning = errors.New("the project's environment is already being set up")

const maxSetupLog = 64 << 10

// StartSetup sets up the environment of the project at project in the background, unless a setup is
// already running.
func (k *Catalog) StartSetup(project string) error {
	k.setupMu.Lock()
	defer k.setupMu.Unlock()
	if k.setupStatus.State == "running" {
		return ErrSetupRunning
	}
	k.setupStatus = SetupStatus{State: "running"}

	go func() {
		err := k.setUpProjectEnvironment(project)
		k.setupMu.Lock()
		defer k.setupMu.Unlock()
		if err != nil {
			k.setupStatus.State, k.setupStatus.Error = "failed", err.Error()
			log.Warn().Msgf("setting up a Python environment in %s failed: %v", project, err)
			return
		}
		k.setupStatus.State, k.setupStatus.Kernel = "succeeded", ProjectKernelName
	}()
	return nil
}

// CurrentSetup answers the state of the last setup.
func (k *Catalog) CurrentSetup() SetupStatus {
	k.setupMu.Lock()
	defer k.setupMu.Unlock()
	return k.setupStatus
}

func (k *Catalog) setupLog(line string) {
	k.setupMu.Lock()
	defer k.setupMu.Unlock()
	k.setupStatus.Log += line + "\n"
	if len(k.setupStatus.Log) > maxSetupLog {
		k.setupStatus.Log = k.setupStatus.Log[len(k.setupStatus.Log)-maxSetupLog:]
	}
}

func (k *Catalog) setUpProjectEnvironment(project string) error {
	uv, base := k.setupTools()

	env := projectEnvironment(project)
	if env == "" {
		env = filepath.Join(project, ".venv")
		// Never replaced: whatever is there is someone's, and a Python-less .venv is not ours to delete.
		if fileExists(env) {
			return fmt.Errorf("%s is already there but has no Python in it; remove it and try again", env)
		}
		var err error
		switch {
		case uv != "":
			err = k.runSetupCommand(project, uv, "venv", env)
		case base != "":
			err = k.runSetupCommand(project, base, "-m", "venv", env)
		default:
			err = errors.New("no Python was found to create the environment with; install Python 3 from python.org and try again")
		}
		if err != nil {
			return err
		}
	}

	python := pythonIn(env)
	if python == "" {
		return fmt.Errorf("%s has no Python in it", env)
	}
	if inspected := inspectEnvironment(env); inspected != nil && ipykernelResources(inspected.Paths) != "" {
		k.setupLog("ipykernel is already installed in " + env)
	} else {
		var err error
		if uv != "" {
			err = k.runSetupCommand(project, uv, "pip", "install", "--python", python, "ipykernel")
		} else {
			err = k.runSetupCommand(project, python, "-m", "pip", "install", "ipykernel")
		}
		if err != nil {
			return err
		}
	}
	if err := k.runSetupCommand(project, python, "-c", "import ipykernel"); err != nil {
		return fmt.Errorf("ipykernel was installed but cannot be imported: %w", err)
	}

	log.Info().Msgf("set up %s with ipykernel", env)
	return nil
}

// runSetupCommand runs one step with its output going to the job's log, line by line as it comes.
func (k *Catalog) runSetupCommand(dir, name string, args ...string) error {
	k.setupLog("$ " + strings.Join(append([]string{name}, args...), " "))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	// Not the environment Zasper itself may have been started in, which is not the one being made.
	cmd.Env = append(withoutVariable(os.Environ(), "VIRTUAL_ENV"), "PIP_DISABLE_PIP_VERSION_CHECK=1", "NO_COLOR=1")

	reader, writer := io.Pipe()
	cmd.Stdout, cmd.Stderr = writer, writer
	done := make(chan struct{})
	go func() {
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 64<<10), 1<<20)
		for scanner.Scan() {
			k.setupLog(scanner.Text())
		}
		// A line past the buffer stops the scanner; the rest is drained so the command cannot block.
		io.Copy(io.Discard, reader)
		close(done)
	}()

	err := cmd.Run()
	writer.Close()
	<-done
	if err != nil {
		return fmt.Errorf("%s failed: %w", filepath.Base(name), err)
	}
	return nil
}

func withoutVariable(environ []string, name string) []string {
	kept := make([]string, 0, len(environ))
	for _, entry := range environ {
		if !strings.HasPrefix(entry, name+"=") {
			kept = append(kept, entry)
		}
	}
	return kept
}

func (k *Catalog) findSetupTools() (uv string, base string) {
	if path, err := exec.LookPath("uv"); err == nil {
		uv = path
	} else {
		home, _ := os.UserHomeDir()
		// A Zasper opened from the Dock or Finder has launchd's short PATH, without the installers' own.
		for _, path := range []string{
			filepath.Join(home, ".local", "bin", "uv"+exeSuffix()),
			filepath.Join(home, ".cargo", "bin", "uv"+exeSuffix()),
			"/opt/homebrew/bin/uv",
			"/usr/local/bin/uv",
		} {
			if isExecutable(path) {
				uv = path
				break
			}
		}
	}
	for _, c := range k.candidates() {
		if c.env == "" && probe(c.path) != nil {
			base = c.path
			break
		}
	}
	return uv, base
}
