package utils

import "os"

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

func GetJupyterPath() []string {

	paths := []string{}
	paths = append(paths, "/home/prasun/.local/jupyter")
	paths = append(paths, "/usr/local/share/jupyter")
	paths = append(paths, "/home/prasun/.local/share/jupyter/") // todo : check
	return paths
}

func GetJupyterConfigPath() string {
	return ""
}
