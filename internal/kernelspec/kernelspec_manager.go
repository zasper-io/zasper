package kernelspec

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"github.com/zasper-io/zasper/internal/core"

	"github.com/rs/zerolog/log"
)

// ErrKernelspecNotFound is a kernel name that no directory on the Jupyter path holds.
var ErrKernelspecNotFound = errors.New("kernelspec not found")

type KernelspecResponse struct {
	Default    string                     `json:"default"`
	Kernespecs map[string]KernelspecModel `json:"kernelspecs"`
}

type KernelSpecJsonData struct {
	Argv          []string          `json:"argv"`
	DisplayName   string            `json:"display_name"`
	Language      string            `json:"language"`
	Metadata      interface{}       `json:"metadata"`
	Name          string            `json:"name"`
	Mimetype      string            `json:"mimetype"`
	Env           map[string]string `json:"env,omitempty"`
	ResourceDir   string            `json:"resource_dir"`
	InterruptMode string            `json:"interrupt_mode"`
}

type KspecData struct {
	ResourceDir string             `json:"resource_dir"`
	Spec        KernelSpecJsonData `json:"spec"`
}

// JupyterSpec is a spec as Jupyter Server's REST API has it: jupyter_client's KernelSpec.to_dict().
type JupyterSpec struct {
	Argv          []string          `json:"argv"`
	Env           map[string]string `json:"env"`
	DisplayName   string            `json:"display_name"`
	Language      string            `json:"language"`
	InterruptMode string            `json:"interrupt_mode"`
	Metadata      interface{}       `json:"metadata"`
}

// KernelspecModel is Jupyter Server's kernelspec_model, for both /api/kernelspecs routes.
type KernelspecModel struct {
	Name      string            `json:"name"`
	Spec      JupyterSpec       `json:"spec"`
	Resources map[string]string `json:"resources"`
}

func kernelspecModel(name string, spec KernelSpecJsonData) KernelspecModel {
	env := spec.Env
	if env == nil {
		env = map[string]string{}
	}
	metadata := spec.Metadata
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	interruptMode := spec.InterruptMode
	if interruptMode == "" {
		interruptMode = "signal"
	}
	return KernelspecModel{
		Name: name,
		Spec: JupyterSpec{
			Argv:          spec.Argv,
			Env:           env,
			DisplayName:   spec.DisplayName,
			Language:      spec.Language,
			InterruptMode: interruptMode,
			Metadata:      metadata,
		},
		Resources: getResources(name, spec.ResourceDir),
	}
}

func GetAllSpecs() map[string]KspecData {
	/*
		Returns a dict mapping kernel names to kernelspecs.

		Returns a dict of the form::

			{
			  'kernel_name': {
				'resource_dir': '/path/to/kernel_name',
				'spec': {"the spec itself": ...}
			  },
			  ...
			}
	*/
	specs := findKernelSpecs()
	res := make(map[string]KspecData)
	for kname, resourceDir := range specs {
		spec, err := fromResourceDir(resourceDir)
		if err != nil {
			// Skipped, as Jupyter does: listed, it is a nameless entry in the launcher that cannot start.
			log.Warn().Msgf("skipping kernelspec %s: %v", kname, err)
			continue
		}

		res[kname] = KspecData{
			Spec:        spec,
			ResourceDir: resourceDir,
		}
	}
	for name, spec := range virtualSpecs(res) {
		res[name] = KspecData{Spec: spec, ResourceDir: spec.ResourceDir}
	}
	return res
}

// GetKernelSpec reads the spec a kernel name resolves to. An unknown name is ErrKernelspecNotFound,
// never a read of kernel.json from the server's working directory.
func GetKernelSpec(kernelName string) (KernelSpecJsonData, error) {
	resourceDir := findSpecDirectory(kernelName)
	if resourceDir == "" {
		// Not on disk: one of the kernels held in memory for a Python with ipykernel, or nothing.
		if data, ok := GetAllSpecs()[strings.ToLower(kernelName)]; ok {
			return data.Spec, nil
		}
		return KernelSpecJsonData{}, fmt.Errorf("%w: %s", ErrKernelspecNotFound, kernelName)
	}
	return fromResourceDir(resourceDir)
}

func findSpecDirectory(kernelName string) string {
	// Case-insensitive, as Jupyter lists and resolves names lowercased.
	kernelName = strings.ToLower(kernelName)
	kernelDirs := getKernelDirs()
	for _, kernelDir := range kernelDirs {
		dir, err := os.Open(kernelDir)
		if err != nil {
			continue
		}
		files, err := dir.Readdir(0)
		// Closed here rather than deferred: a defer in a loop holds every handle until the function
		// returns, which is the whole of what this was doing wrong.
		dir.Close()
		if err != nil {
			continue
		}
		for _, file := range files {
			path := filepath.Join(kernelDir, file.Name())
			if strings.ToLower(file.Name()) == kernelName && isKernelDir(path) {
				return path
			}

		}
	}
	return ""
}

/*
fromResourceDir reads the kernel.json in resourceDir.

A spec with no argv is an error rather than a zero value: the launcher runs Argv[0], and a spec that
failed to decode used to reach it empty and panic there.
*/
func fromResourceDir(resourceDir string) (KernelSpecJsonData, error) {
	kernelFile := filepath.Join(resourceDir, "kernel.json")
	log.Debug().Msgf("loading file %s", kernelFile)
	byteValue, err := os.ReadFile(kernelFile)
	if err != nil {
		return KernelSpecJsonData{}, err
	}

	var kernelSpecJsonData KernelSpecJsonData
	if err := json.Unmarshal(byteValue, &kernelSpecJsonData); err != nil {
		return KernelSpecJsonData{}, fmt.Errorf("%s: %w", kernelFile, err)
	}
	if len(kernelSpecJsonData.Argv) == 0 {
		return KernelSpecJsonData{}, fmt.Errorf("%s: no argv", kernelFile)
	}
	kernelSpecJsonData.ResourceDir = resourceDir
	return kernelSpecJsonData, nil
}

// getResources is kernelspec_model's: files under /kernelspecs/<name>/, Jupyter Server's own route.
func getResources(kernelName, resourceDir string) map[string]string {

	resources := make(map[string]string)

	// Check for static resource files
	for _, resource := range []string{"kernel.js", "kernel.css"} {
		resourcePath := filepath.Join(resourceDir, resource)
		if _, err := os.Stat(resourcePath); !os.IsNotExist(err) {
			resources[resource] = urlPathJoin("/kernelspecs", kernelName, resource)
		}
	}

	// Check for logo files
	files, _ := filepath.Glob(filepath.Join(resourceDir, "logo-*"))
	for _, logoFile := range files {
		fname := filepath.Base(logoFile)
		noExt := strings.TrimSuffix(fname, filepath.Ext(fname))
		resources[noExt] = urlPathJoin("/kernelspecs", kernelName, fname)
	}

	return resources
}

func urlPathJoin(pieces ...string) string {
	if len(pieces) == 0 {
		return ""
	}

	initial := strings.HasPrefix(pieces[0], "/")
	final := strings.HasSuffix(pieces[len(pieces)-1], "/")

	var stripped []string
	for _, s := range pieces {
		stripped = append(stripped, strings.Trim(s, "/"))
	}

	result := strings.Join(stripped, "/")
	if initial {
		result = "/" + result
	}
	if final {
		result = result + "/"
	}
	if result == "//" {
		result = "/"
	}
	return result
}

func findKernelSpecs() map[string]string {
	/*
		Returns a dict mapping kernel names to resource directories.
	*/
	kernelDirs := getKernelDirs()
	kernelsDict := make(map[string]string)
	for _, kernelDir := range kernelDirs {
		kernels := listKernelsIn(kernelDir)
		for kname, spec := range kernels {
			// First wins: the Jupyter path is in priority order, and findSpecDirectory resolves a name
			// the same way, so what is listed is what launches.
			if _, seen := kernelsDict[kname]; !seen {
				kernelsDict[kname] = spec
			}
		}
	}

	return kernelsDict
}

func getKernelDirs() []string {
	dirs := core.Zasper.JupyterPath
	kernel_dirs := []string{}
	for _, v := range dirs {
		kernel_dirs = append(kernel_dirs, filepath.Join(v, "kernels"))
	}
	return kernel_dirs
}

func listKernelsIn(kernelDir string) map[string]string {
	dir, err := os.Open(kernelDir)
	if err != nil {
		log.Debug().Msgf("No kernels found in %s", kernelDir)
		return nil
	}
	log.Debug().Msgf("kernels found in %s", kernelDir)
	files, err := dir.Readdir(0)
	dir.Close()
	if err != nil {
		log.Debug().Msgf("Error reading directory %s: %v", kernelDir, err)
	}
	kernels := make(map[string]string)
	for _, v := range files {
		path := filepath.Join(kernelDir, v.Name())
		if !isKernelDir(path) {
			continue
		}
		kernels[strings.ToLower(v.Name())] = path
	}
	return kernels
}

func isKernelDir(path string) bool {
	// Check if path is a directory
	fileInfo, err := os.Stat(path)
	if err != nil {
		return false
	}
	if !fileInfo.IsDir() {
		return false
	}

	// Check if "kernel.json" file exists in the directory
	kernelFilePath := filepath.Join(path, "kernel.json")
	_, err = os.Stat(kernelFilePath)

	return err == nil
}

var macUserBase = regexp.MustCompile(`/Library/Python/(\d+\.\d+)$`)

/*
Interpreter answers the Python that installed the spec in resourceDir, or "" when that cannot be told.

A spec written by ipykernel names a bare `python`, and jupyter_client runs it with the server's own
sys.executable — the interpreter whose directories the spec was found in. Zasper has no interpreter of
its own, and borrowing whichever `python3` came first on PATH ran the system Python's kernels with
Homebrew's the moment Homebrew installed one.

Two layouts say whose a spec is: <prefix>/share/jupyter, where prefix is a Python install or a venv,
and macOS's per-version user base, ~/Library/Python/<version>/share/jupyter.
*/
func Interpreter(resourceDir string) string {
	kernels := filepath.Dir(resourceDir)
	data := filepath.Dir(kernels)
	share := filepath.Dir(data)
	if filepath.Base(kernels) != "kernels" || filepath.Base(data) != "jupyter" || filepath.Base(share) != "share" {
		return ""
	}
	prefix := filepath.Dir(share)

	var candidates []string
	if isPythonPrefix(prefix) {
		if runtime.GOOS == "windows" {
			candidates = append(candidates, filepath.Join(prefix, "python.exe"))
		} else {
			candidates = append(candidates, filepath.Join(prefix, "bin", "python3"), filepath.Join(prefix, "bin", "python"))
		}
	}
	if match := macUserBase.FindStringSubmatch(filepath.ToSlash(prefix)); match != nil {
		version := match[1]
		binary := "python" + version
		if onPath, err := exec.LookPath(binary); err == nil {
			candidates = append(candidates, onPath)
		}
		// Found by path rather than by running /usr/bin/python3, which offers to install the Command
		// Line Tools on a Mac that has none.
		candidates = append(candidates,
			filepath.Join("/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions", version, "bin", binary),
			filepath.Join("/Library/Frameworks/Python.framework/Versions", version, "bin", binary),
			filepath.Join("/opt/homebrew/opt/python@"+version, "bin", binary),
			filepath.Join("/usr/local/opt/python@"+version, "bin", binary),
		)
	}

	for _, candidate := range candidates {
		if isExecutable(candidate) {
			return candidate
		}
	}
	return ""
}

// isPythonPrefix is a Python install or a venv, as against a directory that merely has site-packages
// in it: ~/.local has one, and whatever ~/.local/bin/python3 is did not install its kernels.
func isPythonPrefix(prefix string) bool {
	if _, err := os.Stat(filepath.Join(prefix, "pyvenv.cfg")); err == nil {
		return true
	}
	if runtime.GOOS == "windows" {
		_, err := os.Stat(filepath.Join(prefix, "Lib", "os.py"))
		return err == nil
	}
	stdlib, _ := filepath.Glob(filepath.Join(prefix, "lib", "python3*", "os.py"))
	return len(stdlib) > 0
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return runtime.GOOS == "windows" || info.Mode()&0o111 != 0
}

/*
getResourceFile answers the path of one of a kernel's own files, and whether the kernel has one.

The bool is what stops a URL naming a kernel nobody has installed from reading a file that does
exist. findSpecDirectory answers "" for a kernel it cannot find, and filepath.Join("", "go.mod") is
"go.mod" — a path resolved against the directory the server was started in rather than against a
kernelspec — so the handler read it and served it.

The containment check below is for the caller after next: the route hands over a single path segment
today, so `..` cannot arrive in pieces, but Join cleans what it is given and a resource of ".." would
otherwise leave the directory quietly.
*/
func getResourceFile(kernelName, resourcePath string) (string, bool) {
	resourceDir := findSpecDirectory(kernelName)
	if resourceDir == "" {
		// A kernel held in memory serves ipykernel's own logos.
		if data, ok := GetAllSpecs()[strings.ToLower(kernelName)]; ok {
			resourceDir = data.ResourceDir
		}
	}
	if resourceDir == "" {
		return "", false
	}

	full := filepath.Join(resourceDir, resourcePath)
	if !strings.HasPrefix(full, resourceDir+string(os.PathSeparator)) {
		return "", false
	}
	return full, true
}
