package core

import (
	"zasper_go/utils"
)

var Zasper Application

type Application struct {
	BaseUrl           string
	StaticUrl         string
	HomeDir           string
	JupyterConfigDir  string
	JupyterDataDir    string
	JupyterRuntimeDir string
	JupyterPath       []string
	JupyterConfigPath string
}

func SetUpZasper(cwd string) Application {
	if cwd == "." {
		cwd = utils.GetHomeDir()
	}
	application := Application{
		BaseUrl:           "https://zasper.io",
		HomeDir:           cwd,
		StaticUrl:         "/images",
		JupyterConfigDir:  utils.GetJupyterConfigDir(),
		JupyterDataDir:    utils.GetJupyterDataDir(),
		JupyterRuntimeDir: utils.GetJupyterRuntimeDir(),
		JupyterPath:       utils.GetJupyterPath(),
		JupyterConfigPath: utils.GetJupyterConfigPath(),
	}
	return application
}
