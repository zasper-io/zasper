package content

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/zasper-io/zasper/internal/pathsafe"

	"github.com/rs/zerolog/log"
)

// Project is the directory Zasper serves. Every content path is read relative to it, and none may leave it.
type Project struct {
	root string
	// A file larger than this is refused rather than read into a response.
	maxFileSize int64
}

// NewProject is the project at root.
func NewProject(root string) Project {
	// Absolute, because containment is decided on the joined path: a relative root would resolve against
	// whatever the working directory happens to be.
	if absolute, err := filepath.Abs(root); err == nil {
		root = absolute
	}
	return Project{root: root, maxFileSize: 10 << 20}
}

// Root is the project directory, as an absolute path.
func (p Project) Root() string {
	return p.root
}

// SafePath answers the OS path for a project path, or "" for one outside the project.
func (p Project) SafePath(path string) string {
	if p.root == "" {
		return ""
	}
	// Joined onto "." so an absolute path still reads as project-relative and an empty one as the root.
	// IsLocal rather than a prefix test: it is also the containment check CodeQL recognises.
	relative := filepath.Join(".", path)
	if !filepath.IsLocal(relative) {
		log.Warn().Msgf("refused %s, which is outside the project directory %s", path, p.root)
		return ""
	}
	return filepath.Join(p.root, relative)
}

// safeWritePath is SafePath for a write, which reports a path outside the project as an error.
func (p Project) safeWritePath(path string) (string, error) {
	osPath := p.SafePath(path)
	if osPath == "" {
		return "", fmt.Errorf("path %s is outside the project directory", path)
	}
	return osPath, nil
}

var errLinkOutside = errors.New("this is a link to something outside the project, so it is not saved through")

// savePath is safeWritePath for a save, which replaces an existing file: see throughLink.
func (p Project) savePath(path string) (string, error) {
	osPath, err := p.safeWritePath(path)
	if err != nil {
		return "", err
	}
	return p.throughLink(osPath)
}

/*
throughLink answers the file a write to osPath should replace. For a symbolic link that is the file it
points to, so that saving keeps the link rather than swapping it for a copy. A link that leads out of the
project is refused, since writing there is writing somewhere the project directory does not cover.
*/
func (p Project) throughLink(osPath string) (string, error) {
	info, err := os.Lstat(osPath)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		return osPath, nil
	}

	resolved, err := filepath.EvalSymlinks(osPath)
	if err != nil {
		return "", err
	}
	root, err := filepath.EvalSymlinks(p.root)
	if err != nil {
		return "", err
	}
	if _, ok := pathsafe.Within(root, resolved); !ok {
		return "", errLinkOutside
	}
	return resolved, nil
}

// outsideProject reports whether any of paths resolves outside the project directory. A name that only
// contains two dots, such as `v1..2.txt`, is inside it: `..` climbs only as a whole path segment.
func (p Project) outsideProject(paths ...string) bool {
	for _, path := range paths {
		if p.SafePath(path) == "" {
			return true
		}
	}
	return false
}
