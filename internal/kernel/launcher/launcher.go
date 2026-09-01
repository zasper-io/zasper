package launcher

import (
	"fmt"
	"io"
	"os"
	"os/exec"

	"github.com/rs/zerolog/log"
)

func LaunchKernel(kernelCmd []string, kw map[string]interface{}, connFile string) (*os.Process, error) {
	// Log which python will be used
	// pythonCmd := kernelCmd[0]
	// pythonPath, err := exec.LookPath(pythonCmd)
	// if err != nil {
	// 	log.Error().Msgf("Python command '%s' not found in PATH: %v", pythonCmd, err)
	// } else {
	// 	log.Info().Msgf("Using Python: %s", pythonPath)

	// 	// Optionally, also log the Python version and architecture
	// 	versionCmd := exec.Command(pythonPath, "--version")
	// 	if output, err := versionCmd.CombinedOutput(); err == nil {
	// 		log.Info().Msgf("Python version: %s", string(output))
	// 	}

	// 	// Log the architecture of the Python binary
	// 	fileCmd := exec.Command("file", pythonPath)
	// 	if output, err := fileCmd.CombinedOutput(); err == nil {
	// 		log.Info().Msgf("Python architecture: %s", string(output))
	// 	}
	// }

	for i, arg := range kernelCmd {
		if arg == "{connection_file}" {
			kernelCmd[i] = connFile
		}
	}
	// kernelCmd = append(kernelCmd, "--debug")

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

	// Send input to the process
	go func() {
		defer stdin.Close()
		if _, err := stdin.Write([]byte("input data\n")); err != nil {
			log.Fatal().Msgf("Error writing to stdin: %v", err)
		}
	}()

	// Capture stdout and stderr
	go func() {
		if _, err := io.Copy(os.Stdout, stdout); err != nil {
			log.Fatal().Msgf("Error copying stdout: %v", err)
		}
	}()

	go func() {
		if _, err := io.Copy(os.Stderr, stderr); err != nil {
			log.Fatal().Msgf("Error copying stderr: %v", err)
		}
	}()

	log.Debug().Msg("Process started successfully")

	return cmd.Process, nil

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
	log.Info().Msgf("Process %d killed successfully.", pid)
	return nil
}
