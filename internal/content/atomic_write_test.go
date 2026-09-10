/*
That a save which fails partway leaves the file it was replacing untouched.

This is the property os.WriteFile could not offer: it truncates first, so a crash, a full disk or a
power cut during a save left a zero-length notebook and no original to fall back on. The tests below
fail a write deliberately and assert that nothing was lost and nothing was left lying around.
*/
package content

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// failingReader gives up partway through, standing in for a disk that fills or a process that dies.
type failingReader struct {
	before string
}

func (r *failingReader) Read(p []byte) (int, error) {
	if r.before != "" {
		n := copy(p, r.before)
		r.before = r.before[n:]
		return n, nil
	}
	return 0, fmt.Errorf("the disk gave up")
}

func TestAFailedWriteLeavesTheOriginalIntact(t *testing.T) {
	dir := t.TempDir()
	notebook := filepath.Join(dir, "analysis.ipynb")
	require.NoError(t, os.WriteFile(notebook, []byte("the original notebook"), 0o644))

	_, err := writeFileAtomically(notebook, &failingReader{before: "half a note"}, 0o644)
	require.Error(t, err, "the write was supposed to fail")

	survived, readErr := os.ReadFile(notebook)
	require.NoError(t, readErr)
	assert.Equal(t, "the original notebook", string(survived),
		"a failed save must not touch the file it was replacing")

	assert.Empty(t, leftoverTempFiles(t, dir), "the partial write should have been cleaned up")
}

func TestASuccessfulWriteReplacesAndCleansUp(t *testing.T) {
	dir := t.TempDir()
	notebook := filepath.Join(dir, "analysis.ipynb")
	require.NoError(t, os.WriteFile(notebook, []byte("the original notebook"), 0o644))

	written, err := writeFileAtomically(notebook, strings.NewReader("the saved notebook"), 0o644)
	require.NoError(t, err)
	assert.Equal(t, int64(len("the saved notebook")), written)

	saved, err := os.ReadFile(notebook)
	require.NoError(t, err)
	assert.Equal(t, "the saved notebook", string(saved))

	assert.Empty(t, leftoverTempFiles(t, dir))

	// CreateTemp makes 0600, so without the explicit chmod every saved notebook would quietly become
	// owner-only the first time it was written.
	info, err := os.Stat(notebook)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o644), info.Mode().Perm())
}

func TestWriteFileAtomicallyCreatesAFileThatIsNotThereYet(t *testing.T) {
	dir := t.TempDir()
	fresh := filepath.Join(dir, "new.ipynb")

	_, err := writeFileAtomically(fresh, strings.NewReader("{}"), 0o644)
	require.NoError(t, err)

	content, err := os.ReadFile(fresh)
	require.NoError(t, err)
	assert.Equal(t, "{}", string(content))
}

// leftoverTempFiles answers the scratch files the helper is meant to have removed.
func leftoverTempFiles(t *testing.T, dir string) []string {
	t.Helper()

	entries, err := os.ReadDir(dir)
	require.NoError(t, err)

	var leftover []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".zasper-write-") {
			leftover = append(leftover, entry.Name())
		}
	}
	return leftover
}

var _ io.Reader = (*failingReader)(nil)
