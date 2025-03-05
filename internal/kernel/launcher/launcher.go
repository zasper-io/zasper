package launcher

import (
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
	// kernelCmd = append(kernelCmd, "--debug")

	log.Debug().Msgf("kernelCmd is %v", kernelCmd)

	cmd := exec.Command(kernelCmd[0], kernelCmd[1:]...)

	// Create pipes for standard input, output, and error
	stdin, err := cmd.StdinPipe()
	if err != nil {
		log.Fatal().Msgf("Error creating stdin pipe: %v", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Fatal().Msgf("Error creating stdout pipe: %v", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Fatal().Msgf("Error creating stderr pipe: %v", err)
	}
	// Start the command
	if err := cmd.Start(); err != nil {
		log.Fatal().Msgf("Error starting command: %v", err)
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

func ShutdownKernel(pid int) {
	// Find the process
	process, err := os.FindProcess(pid)
	if err != nil {
		log.Fatal().Msgf("Error finding process: %v", err)
	}

	// Kill the process
	if err := process.Kill(); err != nil {
		log.Fatal().Msgf("Error killing process: %v", err)
	}
	log.Info().Msgf("Process %d killed successfully.", pid)
}
