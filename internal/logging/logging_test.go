package logging

import (
	"os"
	"testing"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/stretchr/testify/assert"
)

func TestACallerIsShownRelativeToTheRepository(t *testing.T) {
	if repoRoot == "" {
		t.Skip("built with -trimpath, so callers are already short")
	}

	assert.Equal(t, "internal/kernel/channels.go:12", trimCaller(repoRoot+"internal/kernel/channels.go", 12))
}

// A release built from some other checkout says nothing about where that was.
func TestACallerFromAnotherCheckoutKeepsItsLastTwoSegments(t *testing.T) {
	assert.Equal(t, "kernel/channels.go:7", trimCaller("/home/builder/src/elsewhere/kernel/channels.go", 7))
}

func TestTheAccessLogIsOffUnlessAskedFor(t *testing.T) {
	for value, want := range map[string]bool{
		"": false, "1": true, "true": true, " ON ": true, "yes": true, "0": false, "off": false, "maybe": false,
	} {
		t.Setenv("ZASPER_ACCESS_LOG", value)
		assert.Equal(t, want, AccessLog(), "ZASPER_ACCESS_LOG=%q", value)
	}
}

func TestTheLogFormatCanBeChosen(t *testing.T) {
	t.Setenv("ZASPER_LOG_FORMAT", "json")
	assert.Equal(t, os.Stdout, writer())
	assert.False(t, Console())

	t.Setenv("ZASPER_LOG_FORMAT", "console")
	_, isConsole := writer().(zerolog.ConsoleWriter)
	assert.True(t, isConsole)
	assert.True(t, Console())
}

func TestDebugTurnsOnDebugLines(t *testing.T) {
	level, logger, console := zerolog.GlobalLevel(), log.Logger, Console()
	t.Cleanup(func() {
		zerolog.SetGlobalLevel(level)
		log.Logger = logger
		setConsole(console)
	})
	t.Setenv("ZASPER_LOG_FORMAT", "json")

	SetUp(false)
	assert.Equal(t, zerolog.InfoLevel, zerolog.GlobalLevel())

	SetUp(true)
	assert.Equal(t, zerolog.DebugLevel, zerolog.GlobalLevel())
}

func setConsole(value bool) { console = value }
