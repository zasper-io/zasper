package content

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// errTargetExists is what a rename or a move onto an existing sibling gives back, so the handler can
// answer with a conflict rather than a generic failure.
var errTargetExists = errors.New("a file or folder with that name already exists")

// errIntoItself is a folder moved or copied into its own subtree, which would either be refused by
// the kernel with a bare EINVAL or, for a copy, recurse until the disk filled.
var errIntoItself = errors.New("a folder cannot be moved or copied inside itself")

// isInside reports whether osPath is the folder itself or something under it, segment by segment
// rather than by string prefix: `.../projectX-secrets` is not inside `.../projectX`.
func isInside(osPath, folder string) bool {
	if osPath == folder {
		return true
	}
	return strings.HasPrefix(osPath, strings.TrimSuffix(folder, string(os.PathSeparator))+string(os.PathSeparator))
}

func rename(parentDir, oldName, newName string) error {
	if strings.TrimSpace(newName) == "" {
		return errors.New("a name is required")
	}

	// A rename names a sibling. A path here would move the file somewhere else, which is what the
	// move endpoint is for, and the inline rename box does not read like it can do that.
	if strings.ContainsAny(newName, `/\`) {
		return errors.New("a name cannot contain a path separator")
	}
	if newName == "." || newName == ".." {
		return errors.New("a name cannot be only dots")
	}

	return moveContent(filepath.Join(parentDir, oldName), filepath.Join(parentDir, newName))
}

// moveContent moves a file or folder to another project-relative path, which is both a rename and
// what a drag between folders or a cut-and-paste does.
func moveContent(from, to string) error {
	if strings.TrimSpace(to) == "" {
		return errors.New("a destination is required")
	}

	source, err := safeWritePath(from)
	if err != nil {
		return err
	}
	target, err := safeWritePath(to)
	if err != nil {
		return err
	}

	if _, err := os.Lstat(source); err != nil {
		return err
	}
	if source == target {
		return nil
	}
	if isInside(target, source) {
		return errIntoItself
	}
	// os.Rename replaces an existing target without a word, which for a file browser means a
	// mistyped name destroys a sibling.
	if pathExists(target) {
		return errTargetExists
	}
	// Said plainly, because os.Rename answers a missing destination folder with the same ENOENT it
	// answers a missing source with.
	if !pathExists(filepath.Dir(target)) {
		return fmt.Errorf("there is no folder %s to move into", filepath.Dir(to))
	}

	return os.Rename(source, target)
}
