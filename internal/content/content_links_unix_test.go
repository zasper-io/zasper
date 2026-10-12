//go:build unix

package content

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSavingALinkedFileKeepsTheLink(t *testing.T) {
	project, projectDir := testProject(t)
	target := filepath.Join(projectDir, "real.txt")
	link := filepath.Join(projectDir, "link.txt")
	require.NoError(t, os.WriteFile(target, []byte("before"), 0o644))
	require.NoError(t, os.Symlink("real.txt", link))

	_, err := project.UpdateContent("link.txt", "file", "text", "after")
	require.NoError(t, err)

	info, err := os.Lstat(link)
	require.NoError(t, err)
	assert.NotZero(t, info.Mode()&os.ModeSymlink, "the link was replaced by a regular file")
	written, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, "after", string(written))
}

func TestALinkOutOfTheProjectIsNotSavedThrough(t *testing.T) {
	project, projectDir := testProject(t)
	outside := filepath.Join(t.TempDir(), "outside.txt")
	require.NoError(t, os.WriteFile(outside, []byte("private"), 0o644))
	require.NoError(t, os.Symlink(outside, filepath.Join(projectDir, "link.txt")))

	_, err := project.UpdateContent("link.txt", "file", "text", "overwritten")
	assert.ErrorIs(t, err, errLinkOutside)

	written, err := os.ReadFile(outside)
	require.NoError(t, err)
	assert.Equal(t, "private", string(written))
}
