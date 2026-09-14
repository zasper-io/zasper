package launcher

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"

	"github.com/rs/zerolog/log"
)

/*
Process is a launched kernel. A goroutine of its own reaps it the moment it exits, so a kernel that has
stopped never lingers as a zombie, and Done says when that has happened.
*/
type Process struct {
	Pid int

	process *os.Process
	done    chan struct{}
	// Written once, before done is closed.
	state *os.ProcessState
}

// Done is closed once the process has exited and been reaped.
func (p *Process) Done() <-chan struct{} {
	return p.done
}

// Exited reports whether the process has exited.
func (p *Process) Exited() bool {
	select {
	case <-p.done:
		return true
	default:
		return false
	}
}

// ExitCode is the exit status of a process that has exited, and -1 for one still running or ended by a
// signal.
func (p *Process) ExitCode() int {
	if !p.Exited() || p.state == nil {
		return -1
	}
	return p.state.ExitCode()
}

// validPid guards every signal: a pid of 0 or below names a whole process group on Unix, the server's
// own among them, and a manager that never launched has a pid of 0.
func (p *Process) validPid() error {
	if p.Pid <= 0 {
		return fmt.Errorf("refusing to signal invalid pid %d", p.Pid)
	}
	return nil
}

func LaunchKernel(kernelCmd []string, kw map[string]interface{}, connFile string) (*Process, error) {
	for i, arg := range kernelCmd {
		if arg == "{connection_file}" {
			kernelCmd[i] = connFile
		}
	}
	log.Debug().Msgf("kernelCmd is %v", kernelCmd)

	cmd := exec.Command(kernelCmd[0], kernelCmd[1:]...)
	// The server's environment with the kernelspec's on top (KernelManager.preLaunch). Without it the
	// kernel inherits the server's alone, and a spec's own env never reached the process.
	if env, ok := kw["env"].([]string); ok {
		cmd.Env = env
	}
	// Without it the kernel inherits the server's working directory, not the notebook's.
	if dir, ok := kw["cwd"].(string); ok && dir != "" {
		cmd.Dir = dir
	}
	// A process group of its own, so that interrupting or stopping the kernel reaches what it started.
	setProcessGroup(cmd)

	// Create pipes for standard input, output, and error
	stdin, err := cmd.StdinPipe()
	if err != nil {
		log.Error().Msgf("Error creating stdin pipe: %v", err)
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Error().Msgf("Error creating stdout pipe: %v", err)
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Error().Msgf("Error creating stderr pipe: %v", err)
		return nil, err
	}
	// Start the command
	if err := cmd.Start(); err != nil {
		log.Error().Msgf("Error starting command: %v", err)
		return nil, err
	}

	process := &Process{Pid: cmd.Process.Pid, process: cmd.Process, done: make(chan struct{})}
	go func() {
		state, err := cmd.Process.Wait()
		if err != nil {
			log.Debug().Err(err).Int("pid", process.Pid).Msg("could not wait for the kernel process")
		}
		process.state = state
		close(process.done)
	}()

	// The kernel is spoken to over ZMQ, not stdin. This used to write the literal bytes "input data"
	// into every kernel it started, which was debug scaffolding that outlived its purpose; closing
	// the pipe is all that is actually wanted.
	stdin.Close()

	go pipeToLog(stdout, "stdout", process.Pid)
	go pipeToLog(stderr, "stderr", process.Pid)

	log.Debug().Msg("Process started successfully")

	return process, nil
}

/*
pipeToLog drains one of a kernel's output streams into the log, at debug and tagged with its pid.

These two streams used to be io.Copy'd straight into the server's own stdout and stderr, which is why
an ordinary run was interrupted by ipykernel's "Ctrl-C will not work" banner, unlabelled and in the
middle of the server's own lines. The output is kept rather than dropped because a kernel that dies
on startup prints its traceback here and nowhere else — it just sits behind --debug now.
*/
func pipeToLog(stream io.Reader, name string, pid int) {
	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		log.Debug().Int("pid", pid).Str("stream", name).Msg(scanner.Text())
	}
	// A read error here means the kernel is gone, which the caller finds out about by other means.
}
