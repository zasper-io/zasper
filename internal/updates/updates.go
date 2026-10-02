// Package updates finds out whether a newer Zasper has been released, and what changed in the version
// that is running.
package updates

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"golang.org/x/mod/semver"

	"github.com/zasper-io/zasper/internal/atomicfile"
)

// DefaultURL is the one file a check fetches. It names the newest release and nothing else.
const DefaultURL = "https://zasper.io/latest.json"

// Lets the e2e suite point the check at nothing, so a release on zasper.io cannot change what its
// status bar shows. Not a user-facing setting.
const urlEnvVar = "ZASPER_UPDATE_URL"

// Interval is how stale an answer may get before the server asks again.
const Interval = 24 * time.Hour

// Release is what latest.json says about the newest version.
type Release struct {
	Version string `json:"version"`
	Date    string `json:"date"`
	Notes   string `json:"notes"`
	// Minimum is the oldest version without a known security problem. Below it, the update is a
	// security update.
	Minimum string `json:"minimum,omitempty"`
}

// record is ~/.zasper/update-check.json. A failed check keeps the last release it learned of.
type record struct {
	CheckedAt time.Time `json:"checked_at"`
	Latest    *Release  `json:"latest,omitempty"`
	Error     string    `json:"error,omitempty"`
}

// Status is what the banner, the status bar and Settings are told.
type Status struct {
	Version string `json:"version"`
	// Checks is false where something else keeps Zasper up to date, which is the snap.
	Checks         bool       `json:"checks"`
	InstallMethod  string     `json:"install_method,omitempty"`
	UpgradeCommand string     `json:"upgrade_command,omitempty"`
	Latest         *Release   `json:"latest,omitempty"`
	Available      bool       `json:"available"`
	Major          bool       `json:"major"`
	Security       bool       `json:"security"`
	CheckedAt      *time.Time `json:"checked_at,omitempty"`
	Error          string     `json:"error,omitempty"`
}

// Checker asks zasper.io for the newest version at most once a day, and remembers the answer on disk
// so that every server on the machine, and the next start, reads it without asking again.
type Checker struct {
	version   string
	install   Install
	changelog string
	url       string
	path      string
	client    *http.Client
	now       func() time.Time

	mu   sync.Mutex
	last record
}

// New builds the checker for this build. changelog is CHANGELOG.md, which What's new is read from.
func New(version string, install Install, changelog string) *Checker {
	url := os.Getenv(urlEnvVar)
	if url == "" {
		url = DefaultURL
	}
	path := ""
	if home, err := os.UserHomeDir(); err == nil {
		path = filepath.Join(home, ".zasper", "update-check.json")
	}
	c := &Checker{
		version:   version,
		install:   install,
		changelog: changelog,
		url:       url,
		path:      path,
		client:    &http.Client{Timeout: 10 * time.Second},
		now:       time.Now,
	}
	c.last = c.load()
	return c
}

// Checks reports whether this install looks for updates on its own.
func (c *Checker) Checks() bool {
	return c.install.Method != Snap
}

// Run checks whenever the last answer is a day old, until ctx is done. It returns at once in the snap.
func (c *Checker) Run(ctx context.Context) {
	if !c.Checks() {
		return
	}
	for {
		c.mu.Lock()
		due := c.last.CheckedAt.Add(Interval).Sub(c.now())
		c.mu.Unlock()
		if due <= 0 {
			if _, err := c.Check(ctx); err != nil {
				log.Debug().Err(err).Msg("could not check for updates")
			}
			due = Interval
		}
		timer := time.NewTimer(due)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

// Check asks now, whatever the last answer was, and remembers what it was told.
func (c *Checker) Check(ctx context.Context) (Release, error) {
	release, err := c.fetch(ctx)

	c.mu.Lock()
	c.last.CheckedAt = c.now()
	if err != nil {
		c.last.Error = err.Error()
	} else {
		c.last.Latest = &release
		c.last.Error = ""
	}
	saved := c.last
	c.mu.Unlock()

	c.save(saved)
	return release, err
}

func (c *Checker) fetch(ctx context.Context) (Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return Release{}, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return Release{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Release{}, fmt.Errorf("%s answered %s", c.url, resp.Status)
	}

	var release Release
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&release); err != nil {
		return Release{}, fmt.Errorf("%s is not a release: %w", c.url, err)
	}
	if !semver.IsValid(canonical(release.Version)) {
		return Release{}, fmt.Errorf("%s names no version", c.url)
	}
	return release, nil
}

// Status is the last answer, held against the running version. In the snap it says nothing of a
// release, since nothing there is meant to act on one.
func (c *Checker) Status() Status {
	c.mu.Lock()
	last := c.last
	c.mu.Unlock()

	if !c.Checks() {
		return c.Against(nil)
	}
	status := c.Against(last.Latest)
	if !last.CheckedAt.IsZero() {
		checkedAt := last.CheckedAt
		status.CheckedAt = &checkedAt
	}
	status.Error = last.Error
	return status
}

// Against holds a release against the running version.
func (c *Checker) Against(latest *Release) Status {
	status := Status{
		Version:        c.version,
		Checks:         c.Checks(),
		InstallMethod:  c.install.Method,
		UpgradeCommand: c.install.Command,
	}
	if latest == nil {
		return status
	}
	release := *latest
	status.Latest = &release
	status.Available = Newer(release.Version, c.version)
	status.Major = status.Available &&
		semver.Major(canonical(release.Version)) != semver.Major(canonical(c.version))
	status.Security = release.Minimum != "" && Newer(release.Minimum, c.version)
	return status
}

// Newer reports whether version a is later than version b. A version that is not semver, such as
// "unknown", is never newer and nothing is newer than it.
func Newer(a, b string) bool {
	a, b = canonical(a), canonical(b)
	return semver.IsValid(a) && semver.IsValid(b) && semver.Compare(a, b) > 0
}

func canonical(version string) string {
	if version == "" || version[0] == 'v' {
		return version
	}
	return "v" + version
}

func (c *Checker) load() record {
	var last record
	if c.path == "" {
		return last
	}
	data, err := os.ReadFile(c.path)
	if err != nil {
		return last
	}
	if err := json.Unmarshal(data, &last); err != nil {
		return record{}
	}
	return last
}

func (c *Checker) save(last record) {
	if c.path == "" {
		return
	}
	encoded, err := json.MarshalIndent(last, "", "  ")
	if err == nil {
		err = os.MkdirAll(filepath.Dir(c.path), 0o755)
	}
	if err == nil {
		_, err = atomicfile.Write(c.path, bytes.NewReader(append(encoded, '\n')), 0o644)
	}
	if err != nil {
		log.Debug().Err(err).Msg("could not remember the update check")
	}
}
