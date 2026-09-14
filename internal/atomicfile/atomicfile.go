// Package atomicfile replaces a file so that a reader sees either the whole old file or the whole new one.
package atomicfile

import (
	"io"
	"os"
	"path/filepath"

	"github.com/rs/zerolog/log"
)

/*
Write replaces a file's contents without ever leaving a half-written one behind.

os.WriteFile truncates before it writes, so a crash, a full disk or a power cut partway through left a
zero-length file and no way back to the original. Writing beside the target and renaming over it means a
reader sees either the whole old file or the whole new one. The Sync before the rename is what extends
that from "survives a crash" to "survives a power loss": without it the rename can land while the data
behind it has not.

The temporary file is made in the target's own directory, because a rename is only atomic within one
filesystem.
*/
func Write(target string, source io.Reader, perm os.FileMode) (int64, error) {
	// perm is for a new file only: a replaced 0600 secret must not become world-readable, nor a script
	// lose its execute bit.
	if existing, statErr := os.Stat(target); statErr == nil && existing.Mode().IsRegular() {
		perm = existing.Mode().Perm()
	}

	temporary, err := os.CreateTemp(filepath.Dir(target), ".zasper-write-*")
	if err != nil {
		return 0, err
	}
	name := temporary.Name()

	written, err := io.Copy(temporary, source)
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		// CreateTemp makes 0600; the file should end up looking like any other one written here.
		err = os.Chmod(name, perm)
	}
	if err == nil {
		err = os.Rename(name, target)
	}
	if err != nil {
		if removeErr := os.Remove(name); removeErr != nil && !os.IsNotExist(removeErr) {
			log.Error().Err(removeErr).Msgf("Failed to clean up the partial write at %s", name)
		}
		return 0, err
	}

	return written, nil
}
