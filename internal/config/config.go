// Package config reads and writes ~/.zasper/config.json, the one piece of state Zasper keeps between runs.
package config

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/atomicfile"
)

// Config is what config.json holds.
type Config struct {
	TrackingID       string          `json:"tracking_id"`
	Theme            string          `json:"theme"`
	TelemetryEnabled *bool           `json:"telemetry_enabled,omitempty"`
	WidgetCDNEnabled *bool           `json:"widget_cdn_enabled,omitempty"`
	Editor           *EditorSettings `json:"editor,omitempty"`
	// Settings → Language servers.
	LanguageServers *LanguageServerSettings `json:"language_servers,omitempty"`
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

// WidgetCDNEnabled reports whether widget libraries that are not bundled may be loaded from the CDN,
// which they may until it is turned off.
func WidgetCDNEnabled() bool {
	config, err := ReadConfig()
	if err != nil || config.WidgetCDNEnabled == nil {
		return true
	}
	return *config.WidgetCDNEnabled
}

func setWidgetCDN(enabled bool) error {
	_, err := UpdateConfig(func(config *Config) bool {
		config.WidgetCDNEnabled = &enabled
		return true
	})
	return err
}

// SetTelemetryEnabled persists the choice, which also marks the install as having been asked.
func SetTelemetryEnabled(enabled bool) error {
	_, err := UpdateConfig(func(config *Config) bool {
		config.TelemetryEnabled = &enabled
		return true
	})
	return err
}

// EditorSettings are the file editor's defaults: Settings → Editor, and "Use for every file" in the
// status bar. A project's .editorconfig wins over them for the files it covers.
type EditorSettings struct {
	FontSize       int   `json:"font_size"`
	TabSize        int   `json:"tab_size"`
	IndentWithTabs bool  `json:"indent_with_tabs"`
	WordWrap       bool  `json:"word_wrap"`
	LineNumbers    bool  `json:"line_numbers"`
	ShowWhitespace bool  `json:"show_whitespace"`
	Rulers         []int `json:"rulers"`
	// A notebook cell's Tab inserts an indent rather than asking the kernel to complete.
	CellTabIndents bool `json:"cell_tab_indents"`
	// What a save does to whitespace, unless the file's .editorconfig says otherwise.
	TrimTrailingWhitespace bool `json:"trim_trailing_whitespace"`
	InsertFinalNewline     bool `json:"insert_final_newline"`
	// Save a file a second after the typing stops.
	AutoSave bool `json:"auto_save"`
	// Ask the language server to format a file before it is written.
	FormatOnSave bool `json:"format_on_save"`
	// Draw the parameter names and inferred types a language server offers, in the line.
	InlayHints bool `json:"inlay_hints"`
	// Which bindings the file editor takes: "default", "vim" or "emacs".
	Keymap string `json:"keymap"`
}

// Keymaps are the values EditorSettings.Keymap can hold; the frontend loads the module each one names.
var Keymaps = []string{"default", "vim", "emacs"}

// DefaultEditorSettings are what an install that has chosen nothing gets.
func DefaultEditorSettings() EditorSettings {
	return EditorSettings{FontSize: 13, TabSize: 4, LineNumbers: true, Rulers: []int{}, Keymap: "default"}
}

// normalised keeps settings from a hand-edited file or a made-up request inside what the editor can draw.
func (s EditorSettings) normalised() EditorSettings {
	defaults := DefaultEditorSettings()
	if s.FontSize < 8 || s.FontSize > 32 {
		s.FontSize = defaults.FontSize
	}
	if s.TabSize < 1 || s.TabSize > 16 {
		s.TabSize = defaults.TabSize
	}
	rulers := []int{}
	seen := map[int]bool{}
	for _, column := range s.Rulers {
		if column > 0 && column <= 500 && !seen[column] && len(rulers) < 4 {
			seen[column] = true
			rulers = append(rulers, column)
		}
	}
	sort.Ints(rulers)
	s.Rulers = rulers
	if !slices.Contains(Keymaps, s.Keymap) {
		s.Keymap = defaults.Keymap
	}
	return s
}

// GetEditorSettings answers the chosen editor settings, or the defaults when none have been chosen or the
// file cannot be read.
func GetEditorSettings() EditorSettings {
	config, err := ReadConfig()
	if err != nil || config.Editor == nil {
		return DefaultEditorSettings()
	}
	return config.Editor.normalised()
}

func setEditorSettings(settings EditorSettings) error {
	normalised := settings.normalised()
	_, err := UpdateConfig(func(config *Config) bool {
		config.Editor = &normalised
		return true
	})
	return err
}

// LanguageServerSettings are Settings → Language servers: whether servers are started at all, and the
// command to start for a language when discovery finds the wrong one or none.
type LanguageServerSettings struct {
	Disabled bool `json:"disabled"`
	// By language id ("go", "python"); a command line, split the way a shell would split it.
	Commands map[string]string `json:"commands"`
}

func (s LanguageServerSettings) normalised() LanguageServerSettings {
	commands := map[string]string{}
	for language, command := range s.Commands {
		if trimmed := strings.TrimSpace(command); trimmed != "" && language != "" {
			commands[language] = trimmed
		}
	}
	s.Commands = commands
	return s
}

// GetLanguageServerSettings answers the chosen settings, or servers on with nothing overridden.
func GetLanguageServerSettings() LanguageServerSettings {
	config, err := ReadConfig()
	if err != nil || config.LanguageServers == nil {
		return LanguageServerSettings{Commands: map[string]string{}}
	}
	return config.LanguageServers.normalised()
}

func setLanguageServerSettings(settings LanguageServerSettings) error {
	normalised := settings.normalised()
	_, err := UpdateConfig(func(config *Config) bool {
		config.LanguageServers = &normalised
		return true
	})
	return err
}
