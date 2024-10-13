package launcher

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
)

func LaunchKernel(kernelCmd []string, kw map[string]interface{}) *os.Process {
	// args := []string{}
	// cmd := strings.Join(kernelCmd, " ")
	// cmd := "/usr/bin/python3 -m http.server"
	// args := strings.Split(cmd, " ")
	// procAttr := new(os.ProcAttr)
	// procAttr.Files = []*os.File{os.Stdin, os.Stdout, os.Stderr}
	// process, err := os.StartProcess(cmd, args, procAttr)
	// // process, err := os.StartProcess(cmd, args, procAttr)

	// if err != nil {
	// 	log.Printf("ERROR Unable to run %s: %s\n", cmd, err.Error())
	// } else {
	// 	log.Printf("%s running as pid %d\n", cmd, process.Pid)
	// }
	// return process
	// }

	cmd := exec.Command("/usr/bin/python3", "-m", "ipykernel_launcher", "-f", "kernelConnection.json") //  "--debug"

	// Create pipes for standard input, output, and error
	stdin, err := cmd.StdinPipe()
	if err != nil {
		log.Fatalf("Error creating stdin pipe: %v", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Fatalf("Error creating stdout pipe: %v", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Fatalf("Error creating stderr pipe: %v", err)
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		log.Fatalf("Error starting command: %v", err)
	}

	// Send input to the process
	go func() {
		defer stdin.Close()
		if _, err := stdin.Write([]byte("input data\n")); err != nil {
			log.Fatalf("Error writing to stdin: %v", err)
		}
	}()

	// Capture stdout and stderr
	go func() {
		if _, err := io.Copy(os.Stdout, stdout); err != nil {
			log.Fatalf("Error copying stdout: %v", err)
		}
	}()

	go func() {
		if _, err := io.Copy(os.Stderr, stderr); err != nil {
			log.Fatalf("Error copying stderr: %v", err)
		}
	}()

	// Wait for the command to complete
	// if err := cmd.Wait(); err != nil {
	// 	log.Fatalf("Command finished with error: %v", err)
	// }

	// Defer the process closure to ensure it is killed when the main program exits
	// defer func() {
	// 	if cmd.Process != nil {
	// 		fmt.Printf("Killing process with PID: %d\n", cmd.Process.Pid)
	// 		cmd.Process.Kill() // Kill the process when the program exits
	// 	}
	// }()
	fmt.Println("Process started successfully")
	return cmd.Process
}
