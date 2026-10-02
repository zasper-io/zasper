package updates

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/config"
)

func aHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	return home
}

// aRelease serves body as latest.json and counts the requests it answers.
func aRelease(t *testing.T, body string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	t.Setenv(urlEnvVar, server.URL)
	return server, &requests
}

const release200 = `{"version":"2.0.0","date":"2026-09-22","notes":"https://zasper.io/changelog#2.0.0","minimum":"1.0.0"}`

func TestANewerReleaseIsAvailable(t *testing.T) {
	aHome(t)
	aRelease(t, release200)
	checker := New("1.1.0", Install{}, "")

	_, err := checker.Check(context.Background())
	require.NoError(t, err)

	status := checker.Status()
	assert.True(t, status.Available)
	assert.True(t, status.Major)
	assert.False(t, status.Security)
	assert.Equal(t, "2.0.0", status.Latest.Version)
	assert.Equal(t, "https://zasper.io/changelog#2.0.0", status.Latest.Notes)
}

func TestTheNewestVersionHasNothingAvailable(t *testing.T) {
	aHome(t)
	aRelease(t, release200)
	checker := New("2.0.0", Install{}, "")

	_, err := checker.Check(context.Background())
	require.NoError(t, err)
	assert.False(t, checker.Status().Available)
}

func TestAVersionBelowTheMinimumIsASecurityUpdate(t *testing.T) {
	aHome(t)
	aRelease(t, release200)
	checker := New("0.2.0-beta", Install{}, "")

	_, err := checker.Check(context.Background())
	require.NoError(t, err)
	assert.True(t, checker.Status().Security)
}

func TestAFailedCheckKeepsTheLastReleaseItLearnedOf(t *testing.T) {
	aHome(t)
	server, _ := aRelease(t, release200)
	checker := New("1.1.0", Install{}, "")
	_, err := checker.Check(context.Background())
	require.NoError(t, err)

	server.Close()
	_, err = checker.Check(context.Background())
	require.Error(t, err)

	status := checker.Status()
	assert.True(t, status.Available)
	assert.NotEmpty(t, status.Error)
}

func TestAnAnswerThatNamesNoVersionIsAFailure(t *testing.T) {
	aHome(t)
	aRelease(t, `<html>Not found</html>`)
	checker := New("1.1.0", Install{}, "")

	_, err := checker.Check(context.Background())
	require.Error(t, err)
	assert.Nil(t, checker.Status().Latest)
}

func TestTheAnswerIsRememberedForTheNextStart(t *testing.T) {
	home := aHome(t)
	aRelease(t, release200)
	_, err := New("1.1.0", Install{}, "").Check(context.Background())
	require.NoError(t, err)
	assert.FileExists(t, filepath.Join(home, ".zasper", "update-check.json"))

	assert.True(t, New("1.1.0", Install{}, "").Status().Available)
}

func TestRunAsksOnlyWhenTheLastAnswerIsADayOld(t *testing.T) {
	aHome(t)
	_, requests := aRelease(t, release200)
	_, err := New("1.1.0", Install{}, "").Check(context.Background())
	require.NoError(t, err)

	checker := New("1.1.0", Install{}, "")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { checker.Run(ctx); close(done) }()
	time.Sleep(50 * time.Millisecond)
	cancel()
	<-done
	assert.Equal(t, int32(1), requests.Load())

	checker.now = func() time.Time { return time.Now().Add(Interval) }
	ctx, cancel = context.WithCancel(context.Background())
	done = make(chan struct{})
	go func() { checker.Run(ctx); close(done) }()
	require.Eventually(t, func() bool { return requests.Load() == 2 }, time.Second, 10*time.Millisecond)
	cancel()
	<-done
}

func TestTheSnapNeverAsksAndSaysNothingOfARelease(t *testing.T) {
	aHome(t)
	_, requests := aRelease(t, release200)
	checker := New("1.1.0", Install{Method: Snap}, "")

	checker.Run(context.Background())
	assert.Equal(t, int32(0), requests.Load())

	_, err := checker.Check(context.Background())
	require.NoError(t, err)
	status := checker.Status()
	assert.False(t, status.Checks)
	assert.False(t, status.Available)
	assert.Nil(t, status.Latest)
}

func TestNewerComparesVersionsNotStrings(t *testing.T) {
	assert.True(t, Newer("1.10.0", "1.9.0"))
	assert.True(t, Newer("1.0.0", "1.0.0-beta"))
	assert.False(t, Newer("1.0.0", "1.0.0"))
	assert.False(t, Newer("2.0.0", "unknown"))
	assert.False(t, Newer("unknown", "1.0.0"))
}

func TestAHomebrewCaskIsRecognisedByWhereItLives(t *testing.T) {
	assert.True(t, isHomebrewCask("/opt/homebrew/Caskroom/zasper/2.0.0/zasper"))
	assert.True(t, isHomebrewCask("/home/linuxbrew/.linuxbrew/Caskroom/zasper/2.0.0/zasper"))
	assert.False(t, isHomebrewCask("/usr/local/bin/zasper"))
	assert.False(t, isHomebrewCask("/home/me/Downloads/zasper"))
}

func TestAStampedBuildSaysHowItWasInstalled(t *testing.T) {
	assert.Equal(t, Install{Method: Snap}, DetectInstall(Snap))
	assert.Equal(t, "brew upgrade zasper", DetectInstall(Homebrew).Command)
}

func TestAFirstRunHasNoNotesToShow(t *testing.T) {
	aHome(t)
	MarkFirstRun("2.0.0")
	checker := New("2.0.0", Install{}, changelog)

	assert.False(t, checker.WhatsNewPending())
}

func TestAnUpgradeShowsTheNotesOnce(t *testing.T) {
	aHome(t)
	require.NoError(t, config.SetSeenVersion("1.1.0"))
	MarkFirstRun("2.0.0")
	checker := New("2.0.0", Install{}, changelog)

	assert.True(t, checker.WhatsNewPending())
	require.NoError(t, checker.MarkWhatsNewSeen())
	assert.False(t, checker.WhatsNewPending())
}

func TestAnUpgradeFromBeforeTheNotesWereRecordedShowsThisVersion(t *testing.T) {
	aHome(t)
	require.NoError(t, config.SetTelemetryEnabled(true))
	checker := New("2.0.0", Install{}, changelog)

	assert.True(t, checker.WhatsNewPending())
	notes := checker.WhatsNew()
	assert.Empty(t, notes.From)
	require.Len(t, notes.Sections, 1)
	assert.Equal(t, "2.0.0", notes.Sections[0].Version)
}

func TestSkippedVersionsAreAllShownNewestFirst(t *testing.T) {
	aHome(t)
	require.NoError(t, config.SetSeenVersion("1.0.0"))
	notes := New("2.0.0", Install{}, changelog).WhatsNew()

	assert.Equal(t, "1.0.0", notes.From)
	require.Len(t, notes.Sections, 2)
	assert.Equal(t, "2.0.0", notes.Sections[0].Version)
	assert.Equal(t, "1.1.0", notes.Sections[1].Version)
}

func TestAChangelogSectionIsReadableOutsideTheRepository(t *testing.T) {
	sections := parseChangelog(changelog)

	require.Len(t, sections, 4)
	assert.Equal(t, Section{Version: "2.0.0", Date: "2026-09-22",
		Markdown: "### Added\n\n- **Language servers.** See\n  [docs/LANGUAGE-SERVERS.md](https://github.com/zasper-io/zasper/blob/v2.0.0/docs/LANGUAGE-SERVERS.md).\n- [Keep a Changelog](https://keepachangelog.com/) and [above](#added)."},
		sections[0])
	assert.Equal(t, "First public pre-release.", sections[3].Markdown)
}

func TestTheShippedChangelogParses(t *testing.T) {
	data, err := os.ReadFile("../../CHANGELOG.md")
	require.NoError(t, err)
	sections := parseChangelog(string(data))

	require.NotEmpty(t, sections)
	for _, section := range sections {
		assert.True(t, semverValid(section.Version), section.Version)
		assert.NotEmpty(t, section.Date, section.Version)
		assert.NotContains(t, section.Markdown, "](docs/", section.Version)
	}
}

const changelog = `# Changelog

All notable changes to Zasper are recorded here.

## [2.0.0] — 2026-09-22

### Added

- **Language servers.** See
  [docs/LANGUAGE-SERVERS.md](docs/LANGUAGE-SERVERS.md).
- [Keep a Changelog](https://keepachangelog.com/) and [above](#added).

## [1.1.0] — 2026-09-14

- A sign-in link.

## [1.0.0] — 2026-09-10

The first stable release.

## [0.1.0-alpha] — 2025-05-23

First public pre-release.

[2.0.0]: https://github.com/zasper-io/zasper/releases/tag/v2.0.0
[0.1.0-alpha]: https://github.com/zasper-io/zasper/releases/tag/v0.1.0-alpha
`
