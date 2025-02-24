package core

import (
	"runtime"

	"github.com/zasper-io/zasper/utils"
)

var Zasper Application

type Application struct {
	BaseUrl           string
	StaticUrl         string
	UserName          string
	HomeDir           string
	JupyterConfigDir  string
	JupyterDataDir    string
	JupyterRuntimeDir string
	JupyterPath       []string
	JupyterConfigPath string
	ProjectName       string
	OSName            string
	Version           string
}

func SetUpZasper(version string, cwd string) Application {
	if cwd == "." {
		cwd = utils.GetHomeDir()
	}

	application := Application{
		BaseUrl:           "http://localhost:8048",
		ProjectName:       utils.GetProjectName(cwd),
		HomeDir:           cwd,
		Version:           string(version),
		UserName:          utils.GetUsername(),
		StaticUrl:         "./images",
		OSName:            runtime.GOOS,
		JupyterConfigDir:  utils.GetJupyterConfigDir(),
		JupyterDataDir:    utils.GetJupyterDataDir(),
		JupyterRuntimeDir: utils.GetJupyterRuntimeDir(),
		JupyterPath:       utils.GetJupyterPath(),
		JupyterConfigPath: utils.GetJupyterConfigPath(),
	}
	return application
}
