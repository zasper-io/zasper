package kernelspec

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/zasper-io/zasper/internal/core"

	"github.com/rs/zerolog/log"
)

type KernelspecResponse struct {
	Default    string                     `json:"default"`
	Kernespecs map[string]KernelspecModel `json:"kernelspecs"`
}

type KernelSpecJsonData struct {
	Argv          []string    `json:"argv"`
	DisplayName   string      `json:"display_name"`
	Language      string      `json:"language"`
	Metadata      interface{} `json:"metadata"`
	Name          string      `json:"name"`
	Mimetype      string      `json:"mimetype"`
	Env           string      `json:"env"`
	ResourceDir   string      `json:"resource_dir"`
	InterruptMode string      `json:"interrupt_mode"`
}

type KspecData struct {
	ResourceDir string             `json:"resource_dir"`
	Spec        KernelSpecJsonData `json:"spec"`
}

type KernelspecModel struct {
	Name      string             `json:"name"`
	Spec      KernelSpecJsonData `json:"spec"`
	Resources interface{}        `json:"resources"`
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
		spec := fromResourceDir(resourceDir)

		res[kname] = KspecData{
			Spec:        spec,
			ResourceDir: resourceDir,
		}
	}
	return res
}

func GetKernelSpec(kernelName string) KernelSpecJsonData {
	resourceDir := findSpecDirectory(kernelName)

	return GetKernelSpecByName(kernelName, resourceDir)
}

func GetKernelSpecByName(kernelName, resourceDir string) KernelSpecJsonData {
	return fromResourceDir(resourceDir)
}

func findSpecDirectory(kernelName string) string {
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
			if file.Name() == kernelName && isKernelDir(path) {
				return path
			}

		}
	}
	return ""
}

func fromResourceDir(resourceDir string) KernelSpecJsonData {
	/*Create a KernelSpec object by reading kernel.json

	  Pass the path to the *directory* containing kernel.json.
	*/

	kernelFile := filepath.Join(resourceDir, "kernel.json")
	log.Debug().Msgf("loading file %s", kernelFile)
	byteValue, _ := os.ReadFile(kernelFile)

	var kernelSpecJsonData KernelSpecJsonData

	err := json.Unmarshal(byteValue, &kernelSpecJsonData)
	if err != nil {
		log.Debug().Msg("error encountered")
	}
	log.Print(kernelSpecJsonData)
	kernelSpecJsonData.ResourceDir = resourceDir
	return kernelSpecJsonData
}

func getResources(kernelName, resourceDir string) map[string]string {

	resources := make(map[string]string)

	// Check for static resource files
	for _, resource := range []string{"kernel.js", "kernel.css"} {
		resourcePath := filepath.Join(resourceDir, resource)
		if _, err := os.Stat(resourcePath); !os.IsNotExist(err) {
			resources[resource] = urlPathJoin(core.Zasper.BaseUrl, "kernelspecs", kernelName, resource)
		}
	}

	// Check for logo files
	files, _ := filepath.Glob(filepath.Join(resourceDir, "logo-*"))
	for _, logoFile := range files {
		fname := filepath.Base(logoFile)
		noExt := strings.TrimSuffix(fname, filepath.Ext(fname))
		resources[noExt] = urlPathJoin("/static/kernelspecs", kernelName, fname)
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
	log.Print(kernelDirs)
	kernelsDict := make(map[string]string)
	for _, kernelDir := range kernelDirs {
		kernels := listKernelsIn(kernelDir)
		for kname, spec := range kernels {
			kernelsDict[kname] = spec
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
		kernels[v.Name()] = path
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
		return "", false
	}

	full := filepath.Join(resourceDir, resourcePath)
	if !strings.HasPrefix(full, resourceDir+string(os.PathSeparator)) {
		return "", false
	}
	return full, true
}
