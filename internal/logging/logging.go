// Package logging owns the process-wide logger: where it writes, in what shape, and how much of a
// source path it shows. Everything else in Zasper logs through the zerolog global that SetUp installs.
package logging

import (
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// console records the choice SetUp made, so that a caller with something to print that is not a log
// line — the startup banner — can ask whether a person is reading.
var console bool

// Console answers whether the logger is writing for a human at a terminal rather than JSON for a
// collector.
func Console() bool { return console }

/*
AccessLog answers whether every served request should get a line, not just the ones that failed.

It is its own switch rather than part of --debug because --debug also turns on per-message logging in
internal/kernel/channels.go, so someone who wants to watch HTTP traffic would have to read it out of
a ZMQ firehose.
*/
func AccessLog() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ZASPER_ACCESS_LOG"))) {
	case "1", "true", "on", "yes":
		return true
	}
	return false
}

/*
SetUp installs the global logger and must run before anything logs.

The shape follows the reader: a terminal gets zerolog's console writer, and anything else — a pipe,
a file, a systemd unit, a container collector — gets JSON. ZASPER_LOG_FORMAT=json|console overrides
the guess, which is what a terminal multiplexer or a CI job that wants the other one needs.
*/
func SetUp(debug bool) {
	zerolog.SetGlobalLevel(zerolog.InfoLevel)
	if debug {
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	}

	// Pinned rather than left to the default, so that a field named took_ms is honest about its unit.
	zerolog.DurationFieldUnit = time.Millisecond

	// Nano rather than plain RFC3339, whose second precision cannot tell two lines of the same request
	// apart and left the console writer rendering every timestamp as .000.
	zerolog.TimeFieldFormat = time.RFC3339Nano

	zerolog.CallerMarshalFunc = func(_ uintptr, file string, line int) string {
		return trimCaller(file, line)
	}

	log.Logger = zerolog.New(writer()).With().Timestamp().Caller().Logger()
}

func writer() io.Writer {
	tty := isTerminal(os.Stdout)

	switch strings.ToLower(strings.TrimSpace(os.Getenv("ZASPER_LOG_FORMAT"))) {
	case "json":
		console = false
		return os.Stdout
	case "console":
		console = true
		return consoleWriter(tty)
	}

	console = tty
	if !tty {
		return os.Stdout
	}
	return consoleWriter(tty)
}

func consoleWriter(color bool) zerolog.ConsoleWriter {
	return zerolog.ConsoleWriter{
		Out: os.Stdout,
		// Wall clock only. A local server's log is read while it is running, so the date is noise and
		// milliseconds are what separate two lines from the same request.
		TimeFormat: "15:04:05.000",
		NoColor:    !color,
	}
}

func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

// repoRoot is the directory this package was compiled from, with the trailing internal/logging
// stripped — the prefix that makes a caller path repo-relative. It is empty when the paths are
// already short, as they are under `go build -trimpath`.
var repoRoot = func() string {
	_, file, _, ok := runtime.Caller(0)
	if !ok || !filepath.IsAbs(file) {
		return ""
	}
	root := filepath.Dir(filepath.Dir(filepath.Dir(file)))
	if root == "" || root == string(filepath.Separator) {
		return ""
	}
	return root + string(filepath.Separator)
}()

/*
trimCaller turns the absolute path zerolog is handed into something worth reading.

zerolog's default is the compiler's path verbatim, which on a release build is wherever the build
machine happened to check the repo out. Trimming to the module root gives internal/kernel/channels.go
instead, and a build from some other root falls back to the last two segments, which is still enough
to find the file and says nothing about the machine.
*/
func trimCaller(file string, line int) string {
	if repoRoot != "" && strings.HasPrefix(file, repoRoot) {
		file = file[len(repoRoot):]
	} else if slash := strings.LastIndexByte(file, '/'); slash > 0 {
		if prev := strings.LastIndexByte(file[:slash], '/'); prev >= 0 {
			file = file[prev+1:]
		}
	}
	return file + ":" + strconv.Itoa(line)
}
