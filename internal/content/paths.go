package content

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/pathsafe"

	"github.com/rs/zerolog/log"
)

func GetSafePath(path string) string {
	// Resolved, because the containment check below compares strings and HomeDir is whatever came
	// in on -cwd: a relative one would make every path look like an escape.
	homeDir, err := filepath.Abs(core.Zasper.HomeDir)
	if err != nil {
		log.Error().Err(err).Msgf("could not resolve the project directory %s", core.Zasper.HomeDir)
		return ""
	}

	// Joined onto "." so an absolute path still reads as project-relative and an empty one as the root.
	// IsLocal rather than a prefix test: it is also the containment check CodeQL recognises.
	relative := filepath.Join(".", path)
	if !filepath.IsLocal(relative) {
		log.Warn().Msgf("refused %s, which is outside the project directory %s", path, homeDir)
		return ""
	}

	return filepath.Join(homeDir, relative)
}

/*
Writes have to be rooted the same way reads are. GetSafePath is what confines a path to the project
directory; without it a relative path resolves against the server process's working directory
instead.
*/
func safeWritePath(path string) (string, error) {
	osPath := GetSafePath(path)
	if osPath == "" {
		return "", fmt.Errorf("path %s is outside the project directory", path)
	}
	return osPath, nil
}

var errLinkOutside = errors.New("this is a link to something outside the project, so it is not saved through")

// savePath is safeWritePath for a save, which replaces an existing file: see throughLink.
func savePath(path string) (string, error) {
	osPath, err := safeWritePath(path)
	if err != nil {
		return "", err
	}
	return throughLink(osPath)
}

/*
throughLink answers the file a write to osPath should replace. For a symbolic link that is the file it
points to, so that saving keeps the link rather than swapping it for a copy. A link that leads out of the
project is refused, since writing there is writing somewhere the project directory does not cover.
*/
func throughLink(osPath string) (string, error) {
	info, err := os.Lstat(osPath)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		return osPath, nil
	}

	resolved, err := filepath.EvalSymlinks(osPath)
	if err != nil {
		return "", err
	}
	root, err := filepath.EvalSymlinks(GetSafePath("."))
	if err != nil {
		return "", err
	}
	if _, ok := pathsafe.Within(root, resolved); !ok {
		return "", errLinkOutside
	}
	return resolved, nil
}
