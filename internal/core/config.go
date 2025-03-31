package core

import (
	"encoding/json"
	"os"
	"runtime"
	"strings"

	"github.com/rs/zerolog/log"
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

// Config structure to hold configuration values
type Config struct {
	TrackingID   string   `json:"tracking_id"`
	LastProjects []string `json:"last_projects"`
	Theme        string   `json:"theme`
}

// Function to expand the ~ to home directory path
func getConfigFilePath() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return homeDir + "/.zasper/config.json", nil
}

// Function to read the config from the file
func ReadConfig() (*Config, error) {
	filePath, err := getConfigFilePath()
	if err != nil {
		return nil, err
	}

	// Open the config file
	file, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			// If the file doesn't exist, return a default config
			return &Config{}, nil
		}
		return nil, err
	}
	defer file.Close()

	// Decode the JSON content into the Config struct
	var config Config
	decoder := json.NewDecoder(file)
	err = decoder.Decode(&config)
	if err != nil {
		return nil, err
	}

	return &config, nil
}

// Function to write the config to the file
func WriteConfig(config *Config) error {
	filePath, err := getConfigFilePath()
	if err != nil {
		return err
	}

	// Create the directory if it doesn't exist
	err = os.MkdirAll(filePath[:strings.LastIndex(filePath, "/")], os.ModePerm)
	if err != nil {
		return err
	}

	// Open the config file (create if it doesn't exist)
	file, err := os.Create(filePath)
	if err != nil {
		return err
	}
	defer file.Close()
	log.Info().Msgf("Writing config to %s", filePath)

	// Write the config struct to the file as JSON
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ") // Pretty-print the JSON
	return encoder.Encode(config)
}

// Function to add a new project to the list of last 5 projects
func addProject(projectName string) error {
	config, err := ReadConfig()
	if err != nil {
		return err
	}

	// Add the new project to the list of last projects
	config.LastProjects = append(config.LastProjects, projectName)

	// If there are more than 5 projects, keep only the last 5
	if len(config.LastProjects) > 5 {
		config.LastProjects = config.LastProjects[len(config.LastProjects)-5:]
	}

	err = WriteConfig(config)
	if err != nil {
		return err
	}

	return nil
}

// Function to generate or retreive Theme from the config
func GetTheme() (string, error) {
	config, err := ReadConfig()
	if err != nil {
		log.Info().Msgf("Error reading config file: %v", err)
		return "", err
	}

	if config.Theme == "" {
		config.Theme = "Light"
		err = WriteConfig(config)
		if err != nil {
			return "", err
		}
	}

	return config.Theme, nil
}

// Function to change theme and persist it
func changeTheme(theme string) error {
	config, err := ReadConfig()
	if err != nil {
		return err
	}

	config.Theme = theme
	err = WriteConfig(config)
	if err != nil {
		return err
	}

	return nil
}
