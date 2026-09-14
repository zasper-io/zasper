package content

import (
	"errors"
	"os"
	"path/filepath"
)

var errProjectRoot = errors.New("the project folder itself cannot be deleted")

func (p Project) deleteFile(filename string) error {
	// "", "." and "/" all resolve to the project folder, which RemoveAll would empty without a word.
	if filepath.Join(".", filename) == "." {
		return errProjectRoot
	}

	// Via the same helper as the writes, so a rejected path says why rather than failing as
	// `remove : no such file or directory`.
	osPath, err := p.safeWritePath(filename)
	if err != nil {
		return err
	}

	info, err := os.Lstat(osPath)
	if err != nil {
		return err
	}

	// RemoveAll for a directory, because the UI offers "Delete Folder" and os.Remove refuses a
	// non-empty one. Kept off files so that deleting one that has already gone still says so.
	if info.IsDir() {
		return os.RemoveAll(osPath)
	}
	return os.Remove(osPath)
}
