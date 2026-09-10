package launcher

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"

	"github.com/rs/zerolog/log"
)

func LaunchKernel(kernelCmd []string, kw map[string]interface{}, connFile string) (*os.Process, error) {
	for i, arg := range kernelCmd {
		if arg == "{connection_file}" {
			kernelCmd[i] = connFile
		}
	}
	log.Debug().Msgf("kernelCmd is %v", kernelCmd)

	cmd := exec.Command(kernelCmd[0], kernelCmd[1:]...)

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

	pid := cmd.Process.Pid

	// The kernel is spoken to over ZMQ, not stdin. This used to write the literal bytes "input data"
	// into every kernel it started, which was debug scaffolding that outlived its purpose; closing
	// the pipe is all that is actually wanted.
	stdin.Close()

	go pipeToLog(stdout, "stdout", pid)
	go pipeToLog(stderr, "stderr", pid)

	log.Debug().Msg("Process started successfully")

	return cmd.Process, nil

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

func ShutdownKernel(pid int) error {
	// A pid of 0 means "every process in this process group" on Unix, which would
	// take the server down with it.
	if pid <= 0 {
		return fmt.Errorf("refusing to shut down invalid pid %d", pid)
	}

	// Find the process
	process, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("error finding process %d: %w", pid, err)
	}

	// Kill the process
	if err := process.Kill(); err != nil {
		return fmt.Errorf("error killing process %d: %w", pid, err)
	}
	// Debug: the provisioner already announced this shutdown at info, and one kernel going away does
	// not need two lines.
	log.Debug().Msgf("process %d killed successfully", pid)
	return nil
}
