package utils

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
)

func GetHomeDir() string {
	dir, _ := os.Getwd()
	return dir
}

func GetUsername() string {
	// Check if the OS is Windows
	if runtime.GOOS == "windows" {
		return os.Getenv("USERNAME") // Windows typically uses "USERNAME"
	}
	// For UNIX-like systems (Linux, macOS), use "USER"
	return os.Getenv("USER")
}

func GetProjectName(absPath string) string {
	// Get the last part of the path (i.e., the project name)
	projectName := filepath.Base(absPath)
	return projectName
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
	homeDir, err := os.UserHomeDir()
	if err != nil {
		fmt.Println(err)
	}

	// Initialize an empty slice to hold the paths
	paths := []string{}

	// Add various possible paths, using the home directory dynamically
	paths = append(paths, filepath.Join(homeDir, ".local", "jupyter"))                                                                  // Linux
	paths = append(paths, "/usr/local/share/jupyter")                                                                                   // Linux
	paths = append(paths, filepath.Join(homeDir, ".local", "share", "jupyter"))                                                         // Linux
	paths = append(paths, filepath.Join(homeDir, "Library", "Jupyter"))                                                                 // miniconda
	paths = append(paths, filepath.Join(homeDir, "anaconda3", "share", "jupyter"))                                                      // Anaconda
	paths = append(paths, filepath.Join(homeDir, "AppData", "Roaming", "jupyter"))                                                      // Windows
	paths = append(paths, filepath.Join(homeDir, "AppData", "Local", "Continuum", "anaconda3", "share", "jupyter"))                     // Windows
	paths = append(paths, filepath.Join(homeDir, "AppData", "Local", "Enthought", "Canopy", "edm", "envs", "User", "share", "jupyter")) // Windows

	// Get Python version (e.g., "3.9")
	pythonVersion, err := getPythonVersion()
	if err != nil {
		return paths
	}
	paths = append(paths, filepath.Join(homeDir, "Library", "Python", pythonVersion, "share", "jupyter"))                               // macOS
	paths = append(paths, filepath.Join(homeDir, "AppData", "Local", "Programs", "Python", "Python"+pythonVersion, "share", "jupyter")) // Windows
	paths = append(paths, filepath.Join(homeDir, "AppData", "Roaming", "Python", "share", "jupyter"))                                   // Windows

	// Return the list of paths
	return paths
}

func GetJupyterConfigPath() string {
	return ""
}
