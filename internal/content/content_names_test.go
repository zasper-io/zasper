package content

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestANameMayContainDotsButNotBeThem(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	require.NoError(t, os.WriteFile(filepath.Join(projectDir, "notes.txt"), []byte("hello"), 0o644))

	require.NoError(t, rename("", "notes.txt", "v1..2.txt"))
	assert.FileExists(t, filepath.Join(projectDir, "v1..2.txt"))

	for _, name := range []string{".", ".."} {
		assert.Error(t, rename("", "v1..2.txt", name), "renamed to %q", name)
	}
	assert.FileExists(t, filepath.Join(projectDir, "v1..2.txt"))
}

func TestAListingIsNamedAfterItsFolder(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	require.NoError(t, os.MkdirAll(filepath.Join(projectDir, "data", "raw"), 0o755))

	model, err := GetContent("data/raw", "directory", "text", 0)
	require.NoError(t, err)

	assert.Equal(t, "raw", model.Name)
	assert.Equal(t, "data/raw", model.Path)
}
