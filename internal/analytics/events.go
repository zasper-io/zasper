package analytics

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

type EventType string

const (
	EventServerStarted  EventType = "server_started"
	EventServerShutdown EventType = "server_shutdown"

	EventNotebookOpened   EventType = "notebook_opened"
	EventFileOpened       EventType = "file_opened"
	EventCodeCellExecuted EventType = "code_cell_executed"

	EventKernelStarted     EventType = "kernel_started"
	EventKernelInterrupted EventType = "kernel_interrupted"
	EventKernelStartFailed EventType = "kernel_start_failed"

	EventTerminalOpened EventType = "terminal_opened"
	EventTerminalClosed EventType = "terminal_closed"

	EventCommandExecuted EventType = "command_executed"
	EventGitOperation    EventType = "git_operation"
	EventThemeChanged    EventType = "theme_changed"
)

// What a property value is allowed to be. There is deliberately no free-text kind: the whole point
// of this file is that a file path, a project name or a cell's source has nowhere to go.
type propKind int

const (
	// One of a fixed set of strings.
	propEnum propKind = iota
	// A label from Bucket, so a raw count or duration never leaves the machine.
	propBucket
	// A bool.
	propBool
	// A developer-authored identifier: lowercase, one colon, no dots or slashes. Used only where the
	// value set is large and still growing (command ids), because an enum there would silently drop
	// every command added after this list was written.
	propSlug
)

type propSpec struct {
	kind   propKind
	values map[string]struct{}
}

func enum(values ...string) propSpec {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		set[value] = struct{}{}
	}
	return propSpec{kind: propEnum, values: set}
}

// Anything a command id may look like. No separator that could carry a path, and short enough that a
// truncated one cannot either.
var slugPattern = regexp.MustCompile(`^[a-z][a-z0-9]*:[a-z0-9-]{1,32}$`)

// The buckets every count and duration is reported in. Bucket is the only way to produce one.
var bucketLabels = []string{"0", "1", "2-5", "6-10", "11-25", "26-50", "51-100", "100+"}

// Kernel languages. NormalizeLanguage maps a kernelspec name onto this set, so an installed kernel
// named after its owner ("anna-research-env") reports "other" rather than travelling.
var kernelLanguages = enum(
	"python", "r", "julia", "go", "javascript", "typescript",
	"scala", "ruby", "rust", "bash", "sql", "haskell", "other",
)

// The git operations worth counting. Read-only handlers are absent on purpose: the UI polls
// status and current-branch, so counting them would drown everything else.
var gitOperations = enum(
	"stage", "unstage", "discard", "commit", "checkout",
	"branch_delete", "fetch", "pull", "push", "init",
)

// Every theme in ui/src/themes (four hues x two modes). Small and stable enough to list.
var themeIDs = enum(
	"teal-light", "teal-dark", "blue-light", "blue-dark",
	"slate-light", "slate-dark", "orange-light", "orange-dark",
)

// File extensions worth distinguishing, without the dot. Everything else is "other" and a file with
// no extension is "none" — a name like `q3-earnings-acme.xlsx` must never reach a property, so this
// list is what the value is mapped onto rather than checked against.
var fileExtensions = enum(
	"none", "other",
	"ipynb", "py", "r", "jl", "go", "rs", "java", "kt", "scala", "rb", "php", "swift",
	"js", "jsx", "ts", "tsx", "c", "h", "cpp", "hpp", "cs",
	"html", "css", "scss", "sass", "less", "vue", "svelte",
	"json", "yaml", "yml", "toml", "ini", "cfg", "xml", "csv", "tsv", "parquet",
	"md", "rst", "txt", "tex", "sql",
	"sh", "bash", "zsh", "fish", "ps1",
	"png", "jpg", "jpeg", "gif", "svg", "webp", "pdf",
	"lock", "env", "gitignore", "dockerfile", "makefile",
)

// The catalogue. An event not named here, or a property not named under its event, does not travel.
var eventRegistry = map[EventType]map[string]propSpec{
	EventServerStarted:  {},
	EventServerShutdown: {"uptime_bucket": {kind: propBucket}},

	EventNotebookOpened: {},
	EventFileOpened:     {"extension": fileExtensions},
	// No cell_type: a markdown cell is rendered in the browser and never reaches a kernel, so the only
	// execution the server can observe is a code one.
	EventCodeCellExecuted: {"kernel_language": kernelLanguages},

	EventKernelStarted: {
		"kernel_language": kernelLanguages,
		"reused":          {kind: propBool},
	},
	EventKernelInterrupted: {"kernel_language": kernelLanguages},
	EventKernelStartFailed: {"kernel_language": kernelLanguages},

	EventTerminalOpened: {},
	EventTerminalClosed: {"duration_bucket": {kind: propBucket}},

	EventCommandExecuted: {"command_id": {kind: propSlug}},
	EventGitOperation:    {"operation": gitOperations},
	EventThemeChanged:    {"theme_id": themeIDs},
}

// KnownEvent reports whether an event name is in the catalogue.
func KnownEvent(event EventType) bool {
	_, ok := eventRegistry[event]
	return ok
}

// Validate checks an event against the catalogue. It rejects rather than sanitises: a property that
// does not fit is a bug or an attempt to smuggle something out, and quietly dropping the key would
// hide both while still sending the event.
func Validate(event EventType, props map[string]interface{}) error {
	allowed, ok := eventRegistry[event]
	if !ok {
		return fmt.Errorf("unknown event %q", event)
	}

	for key, value := range props {
		spec, ok := allowed[key]
		if !ok {
			return fmt.Errorf("event %q does not allow property %q", event, key)
		}
		if err := spec.validate(value); err != nil {
			return fmt.Errorf("event %q property %q: %w", event, key, err)
		}
	}

	return nil
}

func (spec propSpec) validate(value interface{}) error {
	switch spec.kind {
	case propBool:
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("want a bool, got %T", value)
		}
	case propBucket:
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("want a bucket label, got %T", value)
		}
		for _, label := range bucketLabels {
			if text == label {
				return nil
			}
		}
		return fmt.Errorf("%q is not a bucket label", text)
	case propSlug:
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("want an identifier, got %T", value)
		}
		if !slugPattern.MatchString(text) {
			return fmt.Errorf("%q is not an identifier", text)
		}
	case propEnum:
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("want one of a fixed set, got %T", value)
		}
		if _, ok := spec.values[text]; !ok {
			return fmt.Errorf("%q is not an allowed value", text)
		}
	}
	return nil
}

// Bucket puts a count or a duration into one of a handful of ranges. Reporting the range rather than
// the number is what keeps "ran 3 cells" from becoming a fingerprint.
func Bucket(n int) string {
	switch {
	case n <= 0:
		return "0"
	case n == 1:
		return "1"
	case n <= 5:
		return "2-5"
	case n <= 10:
		return "6-10"
	case n <= 25:
		return "11-25"
	case n <= 50:
		return "26-50"
	case n <= 100:
		return "51-100"
	default:
		return "100+"
	}
}

// NormalizeExtension maps a file name onto the allowlist. The mapping happens here rather than at the
// call site so that no caller is ever holding a value it might forget to map.
func NormalizeExtension(name string) string {
	base := strings.ToLower(filepath.Base(name))

	// Two names that are the extension, as far as anyone reading the numbers cares.
	if base == "dockerfile" || base == "makefile" {
		return base
	}

	ext := strings.TrimPrefix(filepath.Ext(base), ".")
	if ext == "" && strings.HasPrefix(base, ".") {
		// A dotfile: filepath.Ext calls all of ".gitignore" the extension of nothing.
		ext = strings.TrimPrefix(base, ".")
	}
	if ext == "" {
		return "none"
	}

	if _, ok := fileExtensions.values[ext]; ok && ext != "none" && ext != "other" {
		return ext
	}
	return "other"
}

// NormalizeLanguage maps a kernelspec name onto the language allowlist. Kernelspec names are
// user-controlled — a conda environment is named by whoever made it — so an unrecognised one has to
// collapse to "other" rather than travel.
func NormalizeLanguage(kernelName string) string {
	name := strings.ToLower(strings.TrimSpace(kernelName))
	if name == "" {
		return "other"
	}

	// Matched by prefix because the common names carry a version: python3, ir, julia-1.10.
	prefixes := []struct {
		prefix   string
		language string
	}{
		{"python", "python"}, {"conda", "python"}, {"pyspark", "python"}, {"xpython", "python"},
		{"julia", "julia"}, {"javascript", "javascript"}, {"tslab", "typescript"},
		{"gophernotes", "go"}, {"golang", "go"}, {"scala", "scala"}, {"spylon", "scala"},
		{"ruby", "ruby"}, {"iruby", "ruby"}, {"rust", "rust"}, {"evcxr", "rust"},
		{"bash", "bash"}, {"sql", "sql"}, {"haskell", "haskell"}, {"ihaskell", "haskell"},
	}
	for _, candidate := range prefixes {
		if strings.HasPrefix(name, candidate.prefix) {
			return candidate.language
		}
	}

	// R's kernelspecs are named "ir" and "R", neither of which prefixes usefully.
	if name == "ir" || name == "r" || strings.HasPrefix(name, "ir-") {
		return "r"
	}
	if name == "go" {
		return "go"
	}

	return "other"
}
