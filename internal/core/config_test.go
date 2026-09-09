/*
The config file, which is the one piece of state Zasper keeps between runs.

None of this had a test, and the reason is worth writing down: getConfigFilePath resolves
~/.zasper/config.json, so a test that called any of it would rewrite the developer's own settings —
their theme, their recent projects — as a side effect of running the suite. Setting HOME to a temp
directory is enough to isolate it on every platform this ships to, since os.UserHomeDir reads that
environment variable, and it needs no seam in the code to do it.

t.Setenv forbids t.Parallel, which suits a package whose state is process-wide anyway.
*/
package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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
	assert.Empty(t, config.LastProjects)
}

func TestWhatIsWrittenIsWhatIsReadBack(t *testing.T) {
	path := aHome(t)

	require.NoError(t, WriteConfig(&Config{
		Theme:        "orange-dark",
		TrackingID:   "abcdefghijklmnopqrstu",
		LastProjects: []string{"/one", "/two"},
	}))

	// The directory is created on the way, since a fresh install has no ~/.zasper either.
	require.FileExists(t, path)

	config, err := ReadConfig()
	require.NoError(t, err)
	assert.Equal(t, "orange-dark", config.Theme)
	assert.Equal(t, "abcdefghijklmnopqrstu", config.TrackingID)
	assert.Equal(t, []string{"/one", "/two"}, config.LastProjects)
}

func TestTheConfigIsWrittenForAPersonToRead(t *testing.T) {
	path := aHome(t)

	require.NoError(t, WriteConfig(&Config{Theme: "teal-light"}))

	body, err := os.ReadFile(path)
	require.NoError(t, err)
	// Indented on purpose: this file is edited by hand often enough that it is part of the contract.
	assert.Contains(t, string(body), "\n  \"theme\"")
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
}

func TestOnlyTheLastFiveProjectsAreKept(t *testing.T) {
	aHome(t)

	for _, project := range []string{"one", "two", "three", "four", "five", "six", "seven"} {
		require.NoError(t, addProject(project))
	}

	config, err := ReadConfig()
	require.NoError(t, err)
	assert.Equal(t, []string{"three", "four", "five", "six", "seven"}, config.LastProjects)
}

func TestAProjectIsAppendedToWhatWasThereBefore(t *testing.T) {
	aHome(t)
	require.NoError(t, WriteConfig(&Config{Theme: "slate-dark", LastProjects: []string{"earlier"}}))

	require.NoError(t, addProject("later"))

	config, err := ReadConfig()
	require.NoError(t, err)
	assert.Equal(t, []string{"earlier", "later"}, config.LastProjects)
	// And the rest of the file survives being rewritten for one field.
	assert.Equal(t, "slate-dark", config.Theme)
}

/*
An unset theme becomes the default, and is written back.

The writing back is the part worth pinning: GetTheme is called by InfoHandler on every boot, so a
first run leaves a config file behind naming the theme the frontend is already showing.
*/
func TestAnUnsetThemeDefaultsAndIsRemembered(t *testing.T) {
	path := aHome(t)

	theme, err := GetTheme()

	require.NoError(t, err)
	assert.Equal(t, "teal-light", theme)
	// Keep this in step with defaultTheme in ui/src/themes/index.ts; the server stores the string
	// and hands it back, and an unknown name resolves to the same default there.
	assert.Equal(t, "teal-light", readRaw(t, path).Theme)
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
	require.NoError(t, WriteConfig(&Config{Theme: "teal-light", LastProjects: []string{"a project"}}))

	require.NoError(t, changeTheme("orange-light"))

	stored := readRaw(t, path)
	assert.Equal(t, "orange-light", stored.Theme)
	assert.Equal(t, []string{"a project"}, stored.LastProjects)
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

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "slate-dark", readRaw(t, path).Theme)
}

func TestABodyThatIsNotJsonIsRefused(t *testing.T) {
	aHome(t)

	recorder := modify(t, "{ not json")

	assert.Equal(t, http.StatusBadRequest, recorder.Code)
}

/*
What the handler does with a key it does not know: nothing, and says so with a 200.

Pinned rather than changed. The frontend only ever sends `theme`, so tightening this to a 400 is a
change to the API's contract rather than a fix, and it should be made deliberately if it is made.
The same goes for the error from changeTheme, which is discarded — a theme that could not be written
is still answered with a 200, so the UI shows a change that did not survive the restart.
*/
func TestAnUnknownKeyIsAcceptedAndIgnored(t *testing.T) {
	path := aHome(t)
	require.NoError(t, WriteConfig(&Config{Theme: "teal-light"}))

	recorder := modify(t, `{"key":"something-else","value":"whatever"}`)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "teal-light", readRaw(t, path).Theme)
}

func TestAnAccessTokenIsLongAndDifferentEveryTime(t *testing.T) {
	seen := map[string]bool{}
	for range 50 {
		token, err := GenerateRandomToken(16)
		require.NoError(t, err)

		assert.Len(t, token, 32, "16 bytes of hex is 32 characters")
		assert.False(t, seen[token], "the same token was generated twice")
		seen[token] = true
	}
}
