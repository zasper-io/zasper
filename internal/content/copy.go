package content

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/zasper-io/zasper/internal/models"

	"github.com/rs/zerolog/log"
)

/*
copyContent copies a file or folder into toDir under a free name, which covers duplicating in place
(toDir being where it already is) as well as pasting elsewhere. The name it took is in the answer,
since the client has no way to predict it.
*/
func (p Project) copyContent(from, toDir string) (models.ContentModel, error) {
	source, err := p.safeWritePath(from)
	if err != nil {
		return models.ContentModel{}, err
	}
	targetDir, err := p.safeWritePath(toDir)
	if err != nil {
		return models.ContentModel{}, err
	}

	info, err := os.Lstat(source)
	if err != nil {
		return models.ContentModel{}, err
	}
	dirInfo, err := os.Stat(targetDir)
	if err != nil {
		return models.ContentModel{}, err
	}
	if !dirInfo.IsDir() {
		return models.ContentModel{}, fmt.Errorf("%s is not a folder", toDir)
	}
	if info.IsDir() && isInside(targetDir, source) {
		return models.ContentModel{}, errIntoItself
	}

	name := availableName(targetDir, copyOf(info.Name(), info.IsDir()))
	target := filepath.Join(targetDir, name)

	if info.IsDir() {
		err = copyTree(source, target)
	} else {
		err = copyEntry(source, target, info)
	}
	if err != nil {
		// A copy that failed halfway leaves a partial tree behind, which is worse than no copy: it
		// looks like a complete one.
		if removeErr := os.RemoveAll(target); removeErr != nil {
			log.Error().Err(removeErr).Msgf("Failed to clean up the partial copy at %s", target)
		}
		return models.ContentModel{}, err
	}

	return createdModel(contentTypeFor(name, info.IsDir()), toDir, name, target)
}

// copyOf keeps the name it was given when that name is free, and otherwise spells the copy the way
// Jupyter does — `notes-Copy1.txt`, then -Copy2. So a copy into another folder arrives under its own
// name and only a duplicate in place, where the name is by definition taken, is renamed. A folder's
// name is left whole, since the part after a dot in `my.project` is not an extension.
func copyOf(name string, isDir bool) func(int) string {
	ext := ""
	if !isDir {
		ext = filepath.Ext(name)
	}
	stem := strings.TrimSuffix(name, ext)

	return func(attempt int) string {
		if attempt == 0 {
			return name
		}
		return fmt.Sprintf("%s-Copy%d%s", stem, attempt, ext)
	}
}

func copyTree(source, target string) error {
	return filepath.Walk(source, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(target, relative)

		if info.IsDir() {
			return os.MkdirAll(destination, info.Mode().Perm())
		}
		return copyEntry(path, destination, info)
	})
}

func copyEntry(source, target string, info os.FileInfo) error {
	if info.Mode()&os.ModeSymlink != 0 {
		// Reproduced as the link it is: following it would pull in whatever it points at, which may be
		// outside the project entirely.
		link, err := os.Readlink(source)
		if err != nil {
			return err
		}
		return os.Symlink(link, target)
	}
	if !info.Mode().IsRegular() {
		// A socket or a device node is not something to reproduce, and skipping one beats failing the
		// whole copy over it.
		log.Warn().Msgf("Skipping %s while copying: not a regular file", source)
		return nil
	}

	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()

	// O_EXCL: availableName picked a name nothing answered to, and a copy is never meant to land on
	// top of something.
	out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}

	return out.Close()
}
