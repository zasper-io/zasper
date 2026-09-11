package kernelspec

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/zasper-io/zasper/internal/core"
)

/*
Kernels for the Pythons that have ipykernel but no kernelspec, held in memory and never written.

jupyter_client does this for its own interpreter: ensure_native_kernel offers `python3` from the
ipykernel it can import when no spec of that name is installed. Zasper has no interpreter of its own,
so it asks the ones it can find. A spec on disk would outlive the environment it names, which is how
~/Library/Jupyter comes to list kernels whose venv has been deleted.
*/

// ProjectKernelName is the project's own .venv. One name for every project, so a notebook saved on it
// finds a collaborator's .venv when they open the same repository.
const ProjectKernelName = "project-venv"

// candidate is a Python to ask about; env is set for the project's environment, which is read from
// disk and never run.
type candidate struct {
	path string
	env  string
}

type interpreter struct {
	Executable string   `json:"executable"`
	Version    string   `json:"version"`
	Prefix     string   `json:"prefix"`
	Paths      []string `json:"paths"`
}

// What finding ipykernel needs. Whether it is installed is checked on disk at every listing, so a
// `pip install ipykernel` made after this ran is seen without asking the interpreter again.
const probeScript = `import json, os, sys
print(json.dumps({"executable": sys.executable, "version": "%d.%d" % sys.version_info[:2], "prefix": sys.prefix, "paths": [p for p in sys.path if p and os.path.isdir(p)]}))`

type probed struct {
	modTime time.Time
	found   *interpreter
}

var (
	probeMu    sync.Mutex
	probeCache = map[string]probed{}
)

// interpreterCandidates is where Pythons are looked for; tests replace it.
var interpreterCandidates = defaultInterpreterCandidates

func defaultInterpreterCandidates() []candidate {
	var found []candidate
	if env := projectEnvironment(core.Zasper.HomeDir); env != "" {
		found = append(found, candidate{path: pythonIn(env), env: env})
	}
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		for _, name := range []string{"python3", "python"} {
			found = append(found, candidate{path: filepath.Join(dir, name+exeSuffix())})
		}
	}
	home, _ := os.UserHomeDir()
	for _, prefix := range []string{
		os.Getenv("VIRTUAL_ENV"),
		os.Getenv("CONDA_PREFIX"),
		filepath.Join(home, "miniconda3"),
		filepath.Join(home, "anaconda3"),
		filepath.Join(home, "miniforge3"),
	} {
		found = append(found, candidate{path: pythonIn(prefix)})
	}
	if runtime.GOOS == "darwin" {
		// The Command Line Tools' Python by its own path, since the /usr/bin shim is never run.
		found = append(found,
			candidate{path: "/Library/Developer/CommandLineTools/usr/bin/python3"},
			candidate{path: "/opt/homebrew/bin/python3"},
			candidate{path: "/usr/local/bin/python3"},
		)
		frameworks, _ := filepath.Glob("/Library/Frameworks/Python.framework/Versions/*/bin/python3")
		for _, python := range frameworks {
			found = append(found, candidate{path: python})
		}
	}
	return usableCandidates(found, runtime.GOOS)
}

func usableCandidates(found []candidate, goos string) []candidate {
	seen := map[string]bool{}
	var usable []candidate
	for _, c := range found {
		if c.path == "" || seen[c.path] || isShim(c.path, goos) {
			continue
		}
		seen[c.path] = true
		usable = append(usable, c)
	}
	return usable
}

// isShim is a python that is not one: macOS's /usr/bin/python3 offers to install the Command Line Tools
// on a Mac that has none, and Windows' WindowsApps\python.exe opens the Store.
func isShim(path, goos string) bool {
	switch goos {
	case "darwin":
		return path == "/usr/bin/python3" || path == "/usr/bin/python"
	case "windows":
		return strings.Contains(strings.ToLower(path), `\windowsapps\`)
	}
	return false
}

func exeSuffix() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}

// pythonIn is the interpreter of an environment or install prefix, or "" when it has none.
func pythonIn(prefix string) string {
	if prefix == "" {
		return ""
	}
	names := []string{filepath.Join("bin", "python3"), filepath.Join("bin", "python")}
	if runtime.GOOS == "windows" {
		names = []string{"python.exe", filepath.Join("Scripts", "python.exe")}
	}
	for _, name := range names {
		if python := filepath.Join(prefix, name); isExecutable(python) {
			return python
		}
	}
	return ""
}

// projectEnvironment is the project's .venv, or its venv, when either has a Python in it.
func projectEnvironment(project string) string {
	if project == "" {
		return ""
	}
	for _, name := range []string{".venv", "venv"} {
		if dir := filepath.Join(project, name); pythonIn(dir) != "" {
			return dir
		}
	}
	return ""
}

// probe asks a Python on PATH or in a known install where it looks for packages, once per binary.
func probe(path string) *interpreter {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() || !isExecutable(path) {
		return nil
	}
	probeMu.Lock()
	cached, ok := probeCache[path]
	probeMu.Unlock()
	if ok && cached.modTime.Equal(info.ModTime()) {
		return cached.found
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var found *interpreter
	if out, err := exec.CommandContext(ctx, path, "-c", probeScript).Output(); err == nil {
		var parsed interpreter
		if json.Unmarshal(out, &parsed) == nil && parsed.Prefix != "" {
			if parsed.Executable == "" {
				parsed.Executable = path
			}
			found = &parsed
		}
	}

	probeMu.Lock()
	probeCache[path] = probed{modTime: info.ModTime(), found: found}
	probeMu.Unlock()
	return found
}

/*
inspectEnvironment reads a project environment off disk. It is not run to find out: a cloned
repository can carry its own .venv/bin/python3, and opening the folder must not execute it. Running it
is for the kernel it becomes, which someone chooses.
*/
func inspectEnvironment(env string) *interpreter {
	python := pythonIn(env)
	if python == "" {
		return nil
	}
	var sitePackages []string
	if runtime.GOOS == "windows" {
		sitePackages = []string{filepath.Join(env, "Lib", "site-packages")}
	} else {
		sitePackages, _ = filepath.Glob(filepath.Join(env, "lib", "python3*", "site-packages"))
	}
	return &interpreter{Executable: python, Version: environmentVersion(env, sitePackages), Prefix: env, Paths: sitePackages}
}

// environmentVersion is pyvenv.cfg's version (venv writes `version`, uv `version_info`), or failing
// that the lib/python3.X directory's.
func environmentVersion(env string, sitePackages []string) string {
	if cfg, err := os.ReadFile(filepath.Join(env, "pyvenv.cfg")); err == nil {
		for _, line := range strings.Split(string(cfg), "\n") {
			key, value, ok := strings.Cut(line, "=")
			key = strings.TrimSpace(key)
			if ok && (key == "version" || key == "version_info") {
				if parts := strings.Split(strings.TrimSpace(value), "."); len(parts) >= 2 {
					return parts[0] + "." + parts[1]
				}
			}
		}
	}
	for _, dir := range sitePackages {
		if lib := filepath.Base(filepath.Dir(dir)); strings.HasPrefix(lib, "python") {
			return strings.TrimPrefix(lib, "python")
		}
	}
	return "3"
}

func ipykernelResources(paths []string) string {
	for _, dir := range paths {
		if _, err := os.Stat(filepath.Join(dir, "ipykernel", "__init__.py")); err == nil {
			return filepath.Join(dir, "ipykernel", "resources")
		}
	}
	return ""
}

/*
virtualSpecs answers a kernel for each Python found with ipykernel in it, skipping any whose
environment a spec on disk already runs: that spec is the kernel for it, and wins on name as well.
*/
func virtualSpecs(onDisk map[string]KspecData) map[string]KernelSpecJsonData {
	candidates := interpreterCandidates()
	found := make([]*interpreter, len(candidates))
	var wg sync.WaitGroup
	for i, c := range candidates {
		wg.Add(1)
		go func(i int, c candidate) {
			defer wg.Done()
			if c.env != "" {
				found[i] = inspectEnvironment(c.env)
			} else {
				found[i] = probe(c.path)
			}
		}(i, c)
	}
	wg.Wait()

	taken := map[string]bool{}
	covered := map[string]bool{}
	for name, data := range onDisk {
		taken[name] = true
		if prefix := ownerPrefix(data.Spec); prefix != "" {
			covered[canonicalPath(prefix)] = true
		}
	}

	virtual := map[string]KernelSpecJsonData{}
	for i, c := range candidates {
		python := found[i]
		if python == nil {
			continue
		}
		prefix := canonicalPath(python.Prefix)
		resources := ipykernelResources(python.Paths)
		if covered[prefix] || resources == "" {
			continue
		}
		covered[prefix] = true

		name := ProjectKernelName
		if c.env == "" {
			name = nativeKernelName(python, taken)
		}
		if taken[name] {
			continue
		}
		taken[name] = true
		virtual[name] = virtualSpec(python, resources)
	}
	return virtual
}

// nativeKernelName is `python3` for the first, as ensure_native_kernel names it when none is
// installed; the rest are told apart by version and where they came from.
func nativeKernelName(python *interpreter, taken map[string]bool) string {
	if !taken["python3"] {
		return "python3"
	}
	base := "python" + python.Version + "-" + environmentLabel(python.Prefix)
	name := base
	for n := 2; taken[name]; n++ {
		name = fmt.Sprintf("%s-%d", base, n)
	}
	return name
}

// virtualSpec is the spec ipykernel's own get_kernel_dict writes, for this interpreter.
func virtualSpec(python *interpreter, resources string) KernelSpecJsonData {
	where := map[string]string{
		"homebrew":   "Homebrew",
		"system":     "system",
		"python.org": "python.org",
		"pyenv":      "pyenv",
		"uv":         "uv",
	}[environmentLabel(python.Prefix)]
	if where == "" {
		where = filepath.Base(python.Prefix)
	}
	spec := KernelSpecJsonData{
		Argv:        []string{python.Executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"},
		DisplayName: fmt.Sprintf("Python %s (%s)", python.Version, where),
		Language:    "python",
		Metadata:    map[string]interface{}{"debugger": true},
		ResourceDir: resources,
	}
	if isVirtualEnv(python.Prefix) {
		// As activating it would, so a `!pip install` in the notebook lands in this environment.
		bin := "bin"
		if runtime.GOOS == "windows" {
			bin = "Scripts"
		}
		spec.Env = map[string]string{
			"VIRTUAL_ENV": python.Prefix,
			"PATH":        filepath.Join(python.Prefix, bin) + string(os.PathListSeparator) + "${PATH}",
		}
	}
	return spec
}

func isVirtualEnv(prefix string) bool {
	_, err := os.Stat(filepath.Join(prefix, "pyvenv.cfg"))
	return err == nil
}

func environmentLabel(prefix string) string {
	slashed := filepath.ToSlash(prefix)
	switch {
	case isVirtualEnv(prefix):
		return "venv"
	case fileExists(filepath.Join(prefix, "conda-meta")):
		return "conda"
	case strings.Contains(slashed, "/homebrew/") || strings.Contains(slashed, "/Cellar/") || strings.HasPrefix(slashed, "/usr/local/opt/"):
		return "homebrew"
	case strings.Contains(slashed, "/CommandLineTools/") || strings.Contains(slashed, "/Xcode"):
		return "system"
	case strings.HasPrefix(slashed, "/Library/Frameworks/Python.framework/"):
		return "python.org"
	case strings.Contains(slashed, "/.pyenv/"):
		return "pyenv"
	case strings.Contains(slashed, "/uv/python/"):
		return "uv"
	case strings.HasPrefix(slashed, "/usr"):
		return "system"
	}
	return "python"
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ownerPrefix is the environment a spec on disk runs in, when its argv or its location says so.
func ownerPrefix(spec KernelSpecJsonData) string {
	if len(spec.Argv) == 0 {
		return ""
	}
	exe := spec.Argv[0]
	if !filepath.IsAbs(exe) {
		exe = Interpreter(spec.ResourceDir)
	}
	if exe == "" {
		return ""
	}
	dir := filepath.Dir(exe)
	if base := filepath.Base(dir); base == "bin" || base == "Scripts" {
		return filepath.Dir(dir)
	}
	return dir
}

func canonicalPath(path string) string {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}
	return filepath.Clean(path)
}
