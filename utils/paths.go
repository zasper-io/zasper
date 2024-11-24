package utils

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
)

func GetHomeDir() string {
	dir, _ := os.Getwd()
	return dir
}

func GetJupyterConfigDir() string {
	return ""
}

func GetJupyterDataDir() string {
	return ""
}

func GetJupyterRuntimeDir() string {
	return ""
}

// getPythonVersion tries to retrieve the installed Python version (e.g., "3.9")
func getPythonVersion() (string, error) {
	// Run `python3 --version` to get the Python version
	cmd := exec.Command("python3", "--version")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("could not get python version: %v", err)
	}

	// Parse the output, e.g., "Python 3.9.7"
	versionOutput := string(output)
	re := regexp.MustCompile(`Python (\d+\.\d+)`)
	matches := re.FindStringSubmatch(versionOutput)
	if len(matches) < 2 {
		return "", fmt.Errorf("unable to parse Python version")
	}

	return matches[1], nil
}

// GetJupyterPath returns a list of possible Jupyter paths, making the function user-agnostic
func GetJupyterPath() []string {
	// Get the home directory from the environment variable
	homeDir := os.Getenv("HOME")
	if homeDir == "" {
		fmt.Println("HOME environment variable is not set")
	}

	// Get Python version (e.g., "3.9")
	pythonVersion, err := getPythonVersion()
	if err != nil {
		return nil
	}

	// Initialize an empty slice to hold the paths
	paths := []string{}

	// Add various possible paths, using the home directory dynamically
	paths = append(paths, filepath.Join(homeDir, ".local", "jupyter"))
	paths = append(paths, "/usr/local/share/jupyter")
	paths = append(paths, filepath.Join(homeDir, ".local", "share", "jupyter"))
	paths = append(paths, filepath.Join(homeDir, "Library", "Python", pythonVersion, "share", "jupyter"))

	// Return the list of paths
	return paths
}

func GetJupyterConfigPath() string {
	return ""
}
