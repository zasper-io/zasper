package utils

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/rs/zerolog/log"
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

/*
GetJupyterPath answers the directories kernelspecs are found in, highest priority first.

`jupyter --paths` comes first when there is one, so a name it knows resolves as it does under Jupyter
Server. It reports only its own Python's directories, though, so the fallback follows it: kernels that
belong to any other Python vanished the moment a new `jupyter` or `python3` came first on PATH.
*/
func GetJupyterPath() []string {
	// Prefer the real home directory if running inside a Snap
	homeDir := os.Getenv("SNAP_REAL_HOME")
	if homeDir == "" {
		var err error
		homeDir, err = os.UserHomeDir()
		if err != nil {
			log.Debug().Msgf("Failed to get home directory: %v", err)
		}
	}
	pythonVersion, _ := getPythonVersion()
	fallback := fallbackJupyterPath(runtime.GOOS, homeDir, os.Getenv, pythonVersion, globPaths)
	return uniquePaths(append(jupyterCLIPaths(), fallback...))
}

// jupyterCLIPaths is `jupyter --paths --json`'s data directories, or nil without a `jupyter`.
func jupyterCLIPaths() []string {
	raw, err := exec.Command("jupyter", "--paths", "--json").Output()
	if err != nil {
		return nil
	}
	var paths struct {
		Data []string `json:"data"`
	}
	if json.Unmarshal(raw, &paths) != nil {
		return nil
	}
	return paths.Data
}

func globPaths(pattern string) []string {
	matches, _ := filepath.Glob(pattern)
	return matches
}

/*
fallbackJupyterPath is the Jupyter data path without a `jupyter` to ask, in jupyter_core's order:
JUPYTER_PATH, the user's data dir and an active environment (which of those two first is
JUPYTER_PREFER_ENV_PATH's call), then the system. Order is precedence — the first directory holding a
kernel name is the one that runs — so the Python installs that `jupyter --paths` would reach through
its own sys.prefix come last.
*/
func fallbackJupyterPath(goos, home string, getenv func(string) string, pythonVersion string, glob func(string) []string) []string {
	var paths []string
	for _, p := range filepath.SplitList(getenv("JUPYTER_PATH")) {
		if p != "" {
			paths = append(paths, p)
		}
	}

	user := []string{jupyterUserDataDir(goos, home, getenv)}
	var env []string
	for _, prefix := range []string{getenv("CONDA_PREFIX"), getenv("VIRTUAL_ENV")} {
		if prefix != "" {
			env = append(env, filepath.Join(prefix, "share", "jupyter"))
		}
	}
	if preferEnvironmentOverUser(getenv) {
		paths = append(append(paths, env...), user...)
	} else {
		paths = append(append(paths, user...), env...)
	}

	if goos == "windows" {
		if programData := getenv("PROGRAMDATA"); programData != "" {
			paths = append(paths, filepath.Join(programData, "jupyter"))
		}
	} else {
		paths = append(paths, "/usr/local/share/jupyter", "/usr/share/jupyter")
	}

	for _, distribution := range []string{"anaconda3", "miniconda3", "miniforge3"} {
		paths = append(paths, filepath.Join(home, distribution, "share", "jupyter"))
	}
	switch goos {
	case "darwin":
		paths = append(paths, "/opt/homebrew/share/jupyter")
		// Every Python's, not only that of the `python3` on PATH: installing Homebrew's Python moved
		// that, and took the system Python's kernels in ~/Library/Python/3.9 with it.
		for _, pattern := range []string{
			filepath.Join(home, "Library", "Python", "*", "share", "jupyter"),
			"/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/*/share/jupyter",
			"/Library/Frameworks/Python.framework/Versions/*/share/jupyter",
		} {
			paths = append(paths, byPythonVersion(glob(pattern), pythonVersion)...)
		}
	case "windows":
		paths = append(paths,
			filepath.Join(home, "AppData", "Roaming", "Python", "share", "jupyter"),
			filepath.Join(home, "AppData", "Local", "Continuum", "anaconda3", "share", "jupyter"),
			filepath.Join(home, "AppData", "Local", "Enthought", "Canopy", "edm", "envs", "User", "share", "jupyter"),
		)
		installs := filepath.Join(home, "AppData", "Local", "Programs", "Python", "Python3*", "share", "jupyter")
		paths = append(paths, byPythonVersion(glob(installs), pythonVersion)...)
	}

	return uniquePaths(paths)
}

// preferEnvironmentOverUser is jupyter_core's rule, read from the environment Zasper was started in.
func preferEnvironmentOverUser(getenv func(string) string) bool {
	if value := getenv("JUPYTER_PREFER_ENV_PATH"); value != "" {
		return !slices.Contains([]string{"no", "n", "false", "off", "0", "0.0"}, strings.ToLower(value))
	}
	if getenv("VIRTUAL_ENV") != "" {
		return true
	}
	condaEnv := getenv("CONDA_DEFAULT_ENV")
	return getenv("CONDA_PREFIX") != "" && condaEnv != "" && condaEnv != "base"
}

/*
byPythonVersion orders one install location's per-version directories: the version of the `python3`
on PATH first, as `jupyter --paths` run by it would have them, then newest first. `Current` is a
symlink to one of the others and is dropped.
*/
func byPythonVersion(dirs []string, current string) []string {
	var kept []string
	for _, dir := range dirs {
		if pythonVersionOf(dir) != nil {
			kept = append(kept, dir)
		}
	}
	want := parseVersion(current)
	sort.SliceStable(kept, func(i, j int) bool {
		a, b := pythonVersionOf(kept[i]), pythonVersionOf(kept[j])
		if aIsCurrent, bIsCurrent := slices.Equal(a, want), slices.Equal(b, want); aIsCurrent != bIsCurrent {
			return aIsCurrent
		}
		return slices.Compare(a, b) > 0
	})
	return kept
}

// pythonVersionOf reads <version>/share/jupyter: "3.12" on macOS, "Python312" on Windows.
func pythonVersionOf(dir string) []int {
	return parseVersion(strings.TrimPrefix(filepath.Base(filepath.Dir(filepath.Dir(dir))), "Python"))
}

func parseVersion(version string) []int {
	major, minor, dotted := strings.Cut(version, ".")
	if !dotted {
		if len(version) < 2 {
			return nil
		}
		major, minor = version[:1], version[1:]
	}
	parsed := make([]int, 0, 2)
	for _, part := range []string{major, minor} {
		n, err := strconv.Atoi(part)
		if err != nil {
			return nil
		}
		parsed = append(parsed, n)
	}
	return parsed
}

func uniquePaths(paths []string) []string {
	seen := make(map[string]bool, len(paths))
	unique := make([]string, 0, len(paths))
	for _, p := range paths {
		if !seen[p] {
			seen[p] = true
			unique = append(unique, p)
		}
	}
	return unique
}

// jupyterUserDataDir is jupyter_core's jupyter_data_dir, where `ipykernel install --user` writes.
func jupyterUserDataDir(goos, home string, getenv func(string) string) string {
	if dir := getenv("JUPYTER_DATA_DIR"); dir != "" {
		return dir
	}
	switch goos {
	case "darwin":
		return filepath.Join(home, "Library", "Jupyter")
	case "windows":
		if appData := getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, "jupyter")
		}
		return filepath.Join(home, ".jupyter", "data")
	default:
		xdg := getenv("XDG_DATA_HOME")
		if xdg == "" {
			xdg = filepath.Join(home, ".local", "share")
		}
		return filepath.Join(xdg, "jupyter")
	}
}

func GetJupyterConfigPath() string {
	return ""
}
