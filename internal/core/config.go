package core

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/atomicfile"
	"github.com/zasper-io/zasper/internal/utils"
)

var Zasper Application

var ServerAccessToken string

func GenerateRandomToken(n int) (string, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

type Application struct {
	UserName string
	// The project directory, as an absolute path.
	HomeDir     string
	JupyterPath []string
	ProjectName string
	OSName      string
	Version     string
}

func SetUpZasper(version string, cwd string) Application {
	// Absolute, so the project is where --cwd said when it was given, whatever the process's working
	// directory is later.
	projectDir, err := filepath.Abs(cwd)
	if err != nil {
		log.Fatal().Err(err).Msgf("could not resolve the project directory %s", cwd)
	}

	// Pinned for a hosted server whose users keep a link, and for the e2e suite, which has to sign in.
	ServerAccessToken = os.Getenv("ZASPER_ACCESS_TOKEN")
	if ServerAccessToken == "" {
		ServerAccessToken, err = GenerateRandomToken(16) // 16 bytes = 32 hex characters
		if err != nil {
			log.Fatal().Msgf("Failed to generate access token: %v", err)
		}
	}

	return Application{
		ProjectName: utils.GetProjectName(projectDir),
		HomeDir:     projectDir,
		Version:     version,
		UserName:    utils.GetUsername(),
		OSName:      runtime.GOOS,
		JupyterPath: utils.GetJupyterPath(),
	}
}

// Config structure to hold configuration values
type Config struct {
	TrackingID       string `json:"tracking_id"`
	Theme            string `json:"theme"`
	TelemetryEnabled *bool  `json:"telemetry_enabled,omitempty"`
}

// DefaultTheme names a theme in ui/src/themes, which is the only place that knows what one means: the
// server stores the string and hands it back, and an unknown name resolves to the same default there.
const DefaultTheme = "teal-light"

// configMu serialises every read-modify-write of the file, so that a theme change and a telemetry
// toggle made at the same moment both survive.
var configMu sync.Mutex

func getConfigFilePath() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(homeDir, ".zasper", "config.json"), nil
}

// ReadConfig reads the config file, answering an empty config when there is none yet.
func ReadConfig() (*Config, error) {
	filePath, err := getConfigFilePath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(filePath)
	if os.IsNotExist(err) {
		return &Config{}, nil
	}
	if err != nil {
		return nil, err
	}

	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	return &config, nil
}

// WriteConfig replaces the whole file. A change to one setting belongs in UpdateConfig, which cannot
// lose a change made alongside it.
func WriteConfig(config *Config) error {
	configMu.Lock()
	defer configMu.Unlock()

	return writeConfig(config)
}

func writeConfig(config *Config) error {
	filePath, err := getConfigFilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return err
	}

	// Indented, because the file is edited by hand.
	encoded, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	log.Debug().Msgf("writing config to %s", filePath)

	// Atomically: a crash partway through os.Create's truncate-and-write left a file ReadConfig refused
	// on every call after.
	_, err = atomicfile.Write(filePath, bytes.NewReader(append(encoded, '\n')), 0o644)
	return err
}

// UpdateConfig reads the config, lets change edit it, and writes it back when change reports that it
// did, all under one lock. It answers the config as it now stands.
func UpdateConfig(change func(*Config) bool) (Config, error) {
	configMu.Lock()
	defer configMu.Unlock()

	config, err := ReadConfig()
	if err != nil {
		return Config{}, err
	}
	if change(config) {
		if err := writeConfig(config); err != nil {
			return Config{}, err
		}
	}
	return *config, nil
}

// GetTheme answers the chosen theme, and DefaultTheme when none has been chosen or the file cannot be
// read. It writes nothing: it is read on every page load, including from a read-only home directory.
func GetTheme() (string, error) {
	config, err := ReadConfig()
	if err != nil {
		return DefaultTheme, err
	}
	if config.Theme == "" {
		return DefaultTheme, nil
	}
	return config.Theme, nil
}

func changeTheme(theme string) error {
	_, err := UpdateConfig(func(config *Config) bool {
		config.Theme = theme
		return true
	})
	return err
}

// TelemetryPreference reports the stored choice and whether one has been made. The second return is
// what the first-run notice keys off: an install that has never been asked is not the same as one
// that was asked and said yes.
func TelemetryPreference() (enabled bool, chosen bool) {
	config, err := ReadConfig()
	if err != nil {
		log.Debug().Msgf("Error reading config file: %v", err)
		return true, false
	}
	if config.TelemetryEnabled == nil {
		return true, false
	}
	return *config.TelemetryEnabled, true
}

// SetTelemetryEnabled persists the choice, which also marks the install as having been asked.
func SetTelemetryEnabled(enabled bool) error {
	_, err := UpdateConfig(func(config *Config) bool {
		config.TelemetryEnabled = &enabled
		return true
	})
	return err
}
