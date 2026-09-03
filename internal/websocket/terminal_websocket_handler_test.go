package websocket

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zasper-io/zasper/internal/core"
)

func projectDir(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	previous := core.Zasper.HomeDir
	core.Zasper.HomeDir = dir
	t.Cleanup(func() { core.Zasper.HomeDir = previous })
	return dir
}

func TestTerminalStartsInTheFolderItWasOpenedFrom(t *testing.T) {
	dir := projectDir(t)
	assert.NoError(t, os.MkdirAll(filepath.Join(dir, "src", "deep"), 0o755))

	assert.Equal(t, filepath.Join(dir, "src", "deep"), terminalWorkingDir("src/deep"))
}

func TestTerminalFallsBackToTheProjectRoot(t *testing.T) {
	dir := projectDir(t)
	assert.NoError(t, os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("hi"), 0o644))

	cases := map[string]string{
		"nothing asked for":      "",
		"outside the project":    "../elsewhere",
		"a file, not a folder":   "notes.txt",
		"a folder that has gone": "src",
	}

	for name, path := range cases {
		t.Run(name, func(t *testing.T) {
			// A shell in the wrong directory writes to the wrong place, so a bad answer is
			// refused rather than passed on to exec.
			assert.Equal(t, dir, terminalWorkingDir(path))
		})
	}
}
