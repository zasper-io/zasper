package pathsafe

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWithin(t *testing.T) {
	root := filepath.FromSlash("/home/ada/project")

	for path, want := range map[string]string{
		"/home/ada/project":              ".",
		"/home/ada/project/notes.ipynb":  "notes.ipynb",
		"/home/ada/project/src/../a.txt": "a.txt",
	} {
		relative, ok := Within(root, filepath.FromSlash(path))
		assert.True(t, ok, path)
		assert.Equal(t, filepath.FromSlash(want), relative, path)
	}

	for _, path := range []string{"/home/ada", "/home/ada/project-secrets/key", "/etc/passwd", "/home/ada/project/../other"} {
		_, ok := Within(root, filepath.FromSlash(path))
		assert.False(t, ok, path)
	}
}
