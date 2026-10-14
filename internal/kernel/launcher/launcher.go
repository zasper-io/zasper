package launcher

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

/*
Process is a launched kernel. A goroutine of its own reaps it the moment it exits, so a kernel that has
stopped never lingers as a zombie, and Done says when that has happened.
*/
type Process struct {
	Pid int
	// Set when the spec kept the process's stdio.
	Stdin  io.WriteCloser
	Stdout io.ReadCloser

	process *os.Process
	done    chan struct{}
	// Written once, before done is closed.
	state *os.ProcessState
	// What this platform signals the process with, in place of a process group where it has none.
	platform *platform

	// The last lines the process wrote, which is where a kernel that dies says why.
	outputMu sync.Mutex
	output   []string
	// The readers of its stdout and stderr, done once both streams have ended.
	streams sync.WaitGroup
}

const (
	keptLines      = 30
	keptLineLength = 500
)

// Output answers the last lines the process wrote to its stdout and stderr, oldest first.
func (p *Process) Output() string {
	p.outputMu.Lock()
	defer p.outputMu.Unlock()
	return strings.Join(p.output, "\n")
}

/*
FinalOutput is Output once what the process wrote last has been read, waiting no longer than within. A
process can exit before its last lines are through the pipe, and those are the lines that say why it
died; but a child it left running holds the pipe open, so the wait has to end.
*/
func (p *Process) FinalOutput(within time.Duration) string {
	read := make(chan struct{})
	go func() {
		p.streams.Wait()
		close(read)
	}()
	select {
	case <-read:
	case <-time.After(within):
	}
	return p.Output()
}

func (p *Process) keep(line string) {
	if len(line) > keptLineLength {
		line = line[:keptLineLength] + "…"
	}
	p.outputMu.Lock()
	defer p.outputMu.Unlock()
	p.output = append(p.output, line)
	if len(p.output) > keptLines {
		p.output = p.output[len(p.output)-keptLines:]
	}
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

// Spec is how a kernel is started: its command line, its whole environment and the folder it starts in.
// A nil Env inherits the server's, and an empty Dir is the server's working directory.
type Spec struct {
	Argv []string
	Env  []string
	Dir  string
	// Talk to the process on its stdin and stdout, as an agent is, rather than logging its output.
	KeepStdio bool
	// Where both stdout and stderr go, interleaved as a terminal shows them, with nothing on stdin. The
	// caller closes its own copy once Launch returns, so that a read sees the end when the output ends.
	Output *os.File
}

// Launch starts a kernel in a process group of its own, so that interrupting or stopping it reaches what
// it started.
func Launch(spec Spec) (*Process, error) {
	if len(spec.Argv) == 0 {
		return nil, errors.New("a kernel needs a command to run")
	}
	log.Debug().Msgf("launching %v", spec.Argv)

	cmd := exec.Command(spec.Argv[0], spec.Argv[1:]...)
	cmd.Env = spec.Env
	cmd.Dir = spec.Dir
	plat, err := prepare(cmd)
	if err != nil {
		return nil, err
	}

	if spec.Output != nil {
		cmd.Stdout = spec.Output
		cmd.Stderr = spec.Output
		if err := cmd.Start(); err != nil {
			plat.release()
			return nil, err
		}
		return reaped(cmd, plat), nil
	}

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
		plat.release()
		return nil, err
	}

	process := reaped(cmd, plat)
	if spec.KeepStdio {
		process.Stdin = stdin
		process.Stdout = stdout
	} else {
		// A kernel is spoken to over ZMQ, not stdin, so closing the pipe is all that is wanted here.
		stdin.Close()
		process.streams.Add(1)
		go process.pipeToLog(stdout, "stdout")
	}
	process.streams.Add(1)
	go process.pipeToLog(stderr, "stderr")

	log.Debug().Msg("Process started successfully")

	return process, nil
}

// reaped is the started cmd as a Process, waited on from the moment it starts.
func reaped(cmd *exec.Cmd, plat *platform) *Process {
	plat.started(cmd.Process)
	process := &Process{Pid: cmd.Process.Pid, process: cmd.Process, done: make(chan struct{}), platform: plat}
	go func() {
		state, err := cmd.Process.Wait()
		if err != nil {
			log.Debug().Err(err).Int("pid", process.Pid).Msg("could not wait for the kernel process")
		}
		process.state = state
		plat.release()
		close(process.done)
	}()
	return process
}

/*
pipeToLog drains one of a kernel's output streams into the log, at debug and tagged with its pid.

These two streams used to be io.Copy'd straight into the server's own stdout and stderr, which is why
an ordinary run was interrupted by ipykernel's "Ctrl-C will not work" banner, unlabelled and in the
middle of the server's own lines. The output is kept rather than dropped because a kernel that dies
on startup prints its traceback here and nowhere else — it sits behind --debug, and its last lines are
kept on the process, for the notebook to be told.
*/
func (p *Process) pipeToLog(stream io.Reader, name string) {
	defer p.streams.Done()
	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		log.Debug().Int("pid", p.Pid).Str("stream", name).Msg(scanner.Text())
		p.keep(scanner.Text())
	}
	// A read error here means the kernel is gone, which the caller finds out about by other means.
}
