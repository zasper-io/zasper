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
}

func SetUpZasper(cwd string) Application {
	if cwd == "." {
		cwd = utils.GetHomeDir()
	}
	application := Application{
		BaseUrl:           "https://zasper.io",
		ProjectName:       utils.GetProjectName(cwd),
		HomeDir:           cwd,
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
