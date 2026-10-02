package updates

import (
	"regexp"
	"strings"

	"golang.org/x/mod/semver"

	"github.com/zasper-io/zasper/internal/config"
)

// Section is one version's part of CHANGELOG.md.
type Section struct {
	Version  string `json:"version"`
	Date     string `json:"date"`
	Markdown string `json:"markdown"`
}

// WhatsNew is what the What's new tab shows.
type WhatsNew struct {
	Version string `json:"version"`
	// From is the version the notes were last shown for, "" when that is not known.
	From     string    `json:"from,omitempty"`
	Sections []Section `json:"sections"`
}

var (
	heading = regexp.MustCompile(`^## \[([^\]]+)\](?:\s+—\s+(\S+))?`)
	// A link reference such as `[2.0.0]: https://…`, which only the file's last section carries.
	linkDefinition = regexp.MustCompile(`(?m)^\[[^\]]+\]: \S+\n?`)
	// A link into the repository, such as `(docs/API.md#removed-in-200)`.
	relativeLink = regexp.MustCompile(`\]\(([^)#:\s][^):\s]*)\)`)
)

// parseChangelog splits CHANGELOG.md into its versions, newest first as the file has them.
func parseChangelog(changelog string) []Section {
	var sections []Section
	var body []string
	flush := func() {
		if len(sections) > 0 {
			text := linkDefinition.ReplaceAllString(strings.Join(body, "\n"), "")
			sections[len(sections)-1].Markdown = strings.TrimSpace(text)
		}
		body = nil
	}
	for _, line := range strings.Split(changelog, "\n") {
		if match := heading.FindStringSubmatch(line); match != nil {
			flush()
			sections = append(sections, Section{Version: match[1], Date: match[2]})
			continue
		}
		body = append(body, line)
	}
	flush()

	for i := range sections {
		blob := "https://github.com/zasper-io/zasper/blob/v" + sections[i].Version + "/"
		sections[i].Markdown = relativeLink.ReplaceAllString(sections[i].Markdown, "]("+blob+"$1)")
	}
	return sections
}

// WhatsNewPending reports whether this version's notes are still to be shown.
func (c *Checker) WhatsNewPending() bool {
	seen := config.SeenVersion()
	if seen == "" {
		return semverValid(c.version) && c.section(c.version) != nil
	}
	return Newer(c.version, seen)
}

// WhatsNew answers every section after the version last shown, up to the running one. When nothing is
// pending, or the version last shown is not known, it is the running version's section alone.
func (c *Checker) WhatsNew() WhatsNew {
	notes := WhatsNew{Version: c.version, Sections: []Section{}}
	seen := config.SeenVersion()
	if Newer(c.version, seen) {
		notes.From = seen
		for _, section := range parseChangelog(c.changelog) {
			if Newer(section.Version, seen) && !Newer(section.Version, c.version) {
				notes.Sections = append(notes.Sections, section)
			}
		}
		return notes
	}
	if section := c.section(c.version); section != nil {
		notes.Sections = append(notes.Sections, *section)
	}
	return notes
}

// MarkWhatsNewSeen records the running version's notes as shown.
func (c *Checker) MarkWhatsNewSeen() error {
	return config.SetSeenVersion(c.version)
}

// MarkFirstRun treats a machine that has never run Zasper as having seen this version's notes, so a
// new install does not open What's new. It has to run before anything else writes config.json.
func MarkFirstRun(version string) {
	if !config.Exists() && semverValid(version) {
		_ = config.SetSeenVersion(version)
	}
}

func (c *Checker) section(version string) *Section {
	for _, section := range parseChangelog(c.changelog) {
		if section.Version == version {
			return &section
		}
	}
	return nil
}

func semverValid(version string) bool {
	return semver.IsValid(canonical(version))
}
