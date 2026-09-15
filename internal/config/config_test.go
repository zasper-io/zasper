/*
The config file, which is the one piece of state Zasper keeps between runs.

getConfigFilePath resolves ~/.zasper/config.json, so a test that called any of it would rewrite the
developer's own settings as a side effect of running the suite. Setting HOME to a temp directory is
enough to isolate it on every platform this ships to, since os.UserHomeDir reads that environment
variable.

t.Setenv forbids t.Parallel, which suits a package whose state is process-wide anyway.
*/
package config

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// aHome points HOME at a temp directory and answers where the config file will land. Nothing is
// written there yet — a fresh install has no config, which is a case of its own.
func aHome(t *testing.T) string {
	t.Helper()

	home := t.TempDir()
	t.Setenv("HOME", home)
	// os.UserHomeDir reads USERPROFILE on Windows; set both so the guard holds wherever this runs.
	t.Setenv("USERPROFILE", home)

	return filepath.Join(home, ".zasper", "config.json")
}

func readRaw(t *testing.T, path string) Config {
	t.Helper()

	body, err := os.ReadFile(path)
	require.NoError(t, err)

	var config Config
	require.NoError(t, json.Unmarshal(body, &config), "file held %s", body)
	return config
}

func TestAMissingConfigReadsAsAnEmptyOne(t *testing.T) {
	aHome(t)

	config, err := ReadConfig()

	// A fresh install has no file, and that is not a failure to boot on.
	require.NoError(t, err)
	require.NotNil(t, config)
	assert.Empty(t, config.Theme)
}

func TestWhatIsWrittenIsWhatIsReadBack(t *testing.T) {
	path := aHome(t)

	require.NoError(t, WriteConfig(&Config{Theme: "orange-dark", TrackingID: "abcdefghijklmnopqrstu"}))

	// The directory is created on the way, since a fresh install has no ~/.zasper either.
	require.FileExists(t, path)

	config, err := ReadConfig()
	require.NoError(t, err)
	assert.Equal(t, "orange-dark", config.Theme)
	assert.Equal(t, "abcdefghijklmnopqrstu", config.TrackingID)
}

func TestTheConfigIsWrittenForAPersonToRead(t *testing.T) {
	path := aHome(t)

	require.NoError(t, WriteConfig(&Config{Theme: "teal-light"}))

	body, err := os.ReadFile(path)
	require.NoError(t, err)
	// Indented on purpose: this file is edited by hand often enough that it is part of the contract.
	assert.Contains(t, string(body), "\n  \"theme\"")
}

func TestAWriteLeavesNothingButTheConfig(t *testing.T) {
	path := aHome(t)

	require.NoError(t, WriteConfig(&Config{Theme: "teal-light"}))
	require.NoError(t, changeTheme("slate-dark"))

	entries, err := os.ReadDir(filepath.Dir(path))
	require.NoError(t, err)
	require.Len(t, entries, 1, "a scratch file from the atomic write was left behind")
	assert.Equal(t, "config.json", entries[0].Name())
}

func TestAConfigThatIsNotJsonIsAnErrorRatherThanAnEmptyOne(t *testing.T) {
	path := aHome(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, []byte("{ this is not json"), 0o644))

	config, err := ReadConfig()

	// Distinct from the missing case above: a file that is there but unreadable is worth saying so,
	// rather than silently starting from defaults and overwriting whatever the reader had.
	assert.Error(t, err)
	assert.Nil(t, config)

	_, err = UpdateConfig(func(config *Config) bool { config.Theme = "slate-dark"; return true })
	assert.Error(t, err)
	body, readErr := os.ReadFile(path)
	require.NoError(t, readErr)
	assert.Equal(t, "{ this is not json", string(body), "an update wrote over a file it could not read")
}

// A theme change, a telemetry toggle and a tracking-id reset are each a read-modify-write, and two of
// them at once lost one.
func TestUpdatesMadeTogetherAreAllKept(t *testing.T) {
	aHome(t)

	var updates sync.WaitGroup
	for range 40 {
		updates.Add(1)
		go func() {
			defer updates.Done()
			_, err := UpdateConfig(func(config *Config) bool {
				count, _ := strconv.Atoi(config.TrackingID)
				config.TrackingID = strconv.Itoa(count + 1)
				return true
			})
			assert.NoError(t, err)
		}()
	}
	updates.Wait()

	config, err := ReadConfig()
	require.NoError(t, err)
	assert.Equal(t, "40", config.TrackingID)
}

func TestAnUpdateThatChangesNothingWritesNothing(t *testing.T) {
	path := aHome(t)

	config, err := UpdateConfig(func(*Config) bool { return false })

	require.NoError(t, err)
	assert.Empty(t, config.Theme)
	assert.NoFileExists(t, path)
}

// Read on every /api/info, so it must not write: a read-only home directory made every one of those a
// failed write.
func TestAnUnsetThemeIsTheDefaultAndIsNotWritten(t *testing.T) {
	path := aHome(t)

	theme, err := GetTheme()

	require.NoError(t, err)
	// Keep this in step with defaultTheme in ui/src/themes/index.ts.
	assert.Equal(t, "teal-light", theme)
	assert.NoFileExists(t, path)
}

func TestAnUnreadableConfigStillAnswersTheDefaultTheme(t *testing.T) {
	path := aHome(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, []byte("{ this is not json"), 0o644))

	theme, err := GetTheme()

	assert.Error(t, err)
	assert.Equal(t, DefaultTheme, theme)
}

func TestAThemeAlreadyChosenIsLeftAlone(t *testing.T) {
	aHome(t)
	require.NoError(t, WriteConfig(&Config{Theme: "blue-dark"}))

	theme, err := GetTheme()

	require.NoError(t, err)
	assert.Equal(t, "blue-dark", theme)
}

func TestChangingTheThemePersistsIt(t *testing.T) {
	path := aHome(t)
	require.NoError(t, WriteConfig(&Config{Theme: "teal-light", TrackingID: "an id"}))

	require.NoError(t, changeTheme("orange-light"))

	stored := readRaw(t, path)
	assert.Equal(t, "orange-light", stored.Theme)
	assert.Equal(t, "an id", stored.TrackingID)
}

// modify calls the handler the way the route does.
func modify(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/config/modify", strings.NewReader(body))
	ConfigModifyHandler(recorder, request)
	return recorder
}

func TestTheThemeCanBeChangedOverTheApi(t *testing.T) {
	path := aHome(t)
	require.NoError(t, WriteConfig(&Config{Theme: "teal-light"}))

	recorder := modify(t, `{"key":"theme","value":"slate-dark"}`)

	assert.Equal(t, http.StatusNoContent, recorder.Code)
	assert.Equal(t, "slate-dark", readRaw(t, path).Theme)
}

func TestABodyThatIsNotJsonIsRefused(t *testing.T) {
	aHome(t)

	recorder := modify(t, "{ not json")

	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.Equal(t, "application/json", recorder.Header().Get("Content-Type"))
}

func TestOnlyASettingThatExistsCanBeChanged(t *testing.T) {
	path := aHome(t)
	require.NoError(t, WriteConfig(&Config{Theme: "teal-light"}))

	for _, body := range []string{`{"key":"something-else","value":"whatever"}`, `{"key":"theme","value":""}`} {
		recorder := modify(t, body)

		assert.Equal(t, http.StatusBadRequest, recorder.Code, body)
		assert.Equal(t, "teal-light", readRaw(t, path).Theme, body)
	}
}

func TestWidgetCodeFromTheCDNCanBeTurnedOffOverTheApi(t *testing.T) {
	path := aHome(t)
	assert.True(t, WidgetCDNEnabled(), "on until it is turned off")

	assert.Equal(t, http.StatusNoContent, modify(t, `{"key":"widget_cdn","value":"off"}`).Code)
	assert.False(t, WidgetCDNEnabled())
	require.NotNil(t, readRaw(t, path).WidgetCDNEnabled)

	assert.Equal(t, http.StatusBadRequest, modify(t, `{"key":"widget_cdn","value":"maybe"}`).Code)
	assert.False(t, WidgetCDNEnabled())

	assert.Equal(t, http.StatusNoContent, modify(t, `{"key":"widget_cdn","value":"on"}`).Code)
	assert.True(t, WidgetCDNEnabled())
}

// A theme that could not be written used to answer 200, so the UI showed a change that did not survive
// the restart.
func TestAThemeThatCannotBeSavedSaysSo(t *testing.T) {
	// HOME is a file, so nothing can be read or written beneath it.
	home := filepath.Join(t.TempDir(), "not-a-directory")
	require.NoError(t, os.WriteFile(home, nil, 0o644))
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	recorder := modify(t, `{"key":"theme","value":"slate-dark"}`)

	assert.Equal(t, http.StatusInternalServerError, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "could not save the theme")
}

func TestEditorSettingsAreTheDefaultsUntilChosen(t *testing.T) {
	aHome(t)

	assert.Equal(t, DefaultEditorSettings(), GetEditorSettings())
}

func TestEditorSettingsCanBeChangedOverTheApi(t *testing.T) {
	path := aHome(t)

	recorder := modify(t, `{"key":"editor","value":"{\"font_size\":15,\"tab_size\":2,\"indent_with_tabs\":true,\"word_wrap\":true,\"line_numbers\":false,\"show_whitespace\":true,\"rulers\":[100,80],\"cell_tab_indents\":true}"}`)

	require.Equal(t, http.StatusNoContent, recorder.Code, "body was %s", recorder.Body)
	assert.Equal(t, EditorSettings{
		FontSize:       15,
		TabSize:        2,
		IndentWithTabs: true,
		WordWrap:       true,
		LineNumbers:    false,
		ShowWhitespace: true,
		Rulers:         []int{80, 100},
		CellTabIndents: true,
		Keymap:         "default",
	}, GetEditorSettings())
	assert.NotNil(t, readRaw(t, path).Editor)
}

func TestEditorSettingsKeepWhatASaveDoesAndWhetherItIsAutomatic(t *testing.T) {
	aHome(t)

	recorder := modify(t, `{"key":"editor","value":"{\"trim_trailing_whitespace\":true,\"insert_final_newline\":true,\"auto_save\":true}"}`)

	require.Equal(t, http.StatusNoContent, recorder.Code, "body was %s", recorder.Body)
	settings := GetEditorSettings()
	assert.True(t, settings.TrimTrailingWhitespace)
	assert.True(t, settings.InsertFinalNewline)
	assert.True(t, settings.AutoSave)
	// The rest of the object was absent, so it is the defaults rather than zeroes the editor cannot draw.
	assert.Equal(t, 13, settings.FontSize)
	assert.Equal(t, 4, settings.TabSize)
}

func TestEditorKeymapIsOneOfTheThreeTheEditorCanLoad(t *testing.T) {
	aHome(t)

	require.Equal(t, http.StatusNoContent, modify(t, `{"key":"editor","value":"{\"keymap\":\"vim\"}"}`).Code)
	assert.Equal(t, "vim", GetEditorSettings().Keymap)

	// A keymap nothing can load would leave the editor with no bindings at all.
	require.Equal(t, http.StatusNoContent, modify(t, `{"key":"editor","value":"{\"keymap\":\"kakoune\"}"}`).Code)
	assert.Equal(t, "default", GetEditorSettings().Keymap)
}

// A hand-edited config or a made-up request: the editor gets values it can draw.
func TestEditorSettingsOutsideWhatTheEditorCanDrawAreBroughtInside(t *testing.T) {
	aHome(t)

	recorder := modify(t, `{"key":"editor","value":"{\"font_size\":400,\"tab_size\":0,\"rulers\":[0,80,80,9000,90,100,120,140]}"}`)

	require.Equal(t, http.StatusNoContent, recorder.Code)
	settings := GetEditorSettings()
	assert.Equal(t, 13, settings.FontSize)
	assert.Equal(t, 4, settings.TabSize)
	assert.Equal(t, []int{80, 90, 100, 120}, settings.Rulers)
}

func TestEditorSettingsThatAreNotJsonAreRefused(t *testing.T) {
	aHome(t)

	recorder := modify(t, `{"key":"editor","value":"font_size=13"}`)

	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.Equal(t, DefaultEditorSettings(), GetEditorSettings())
}
