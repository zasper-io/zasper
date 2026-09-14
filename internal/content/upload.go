package content

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/zasper-io/zasper/internal/atomicfile"
	"github.com/zasper-io/zasper/internal/models"

	"github.com/rs/zerolog/log"
)

/*
uploadContent writes one uploaded file into the project and describes what it wrote.

`relativePath` is the file's path *within* parentDir, which is how a whole folder arrives: the browser
hands over `notes/img/logo.png` for a dropped `notes` folder, one request per file, and the folders
along the way are made here. It is the browser's own string, so it is checked rather than trusted.

The body is written to a temporary file beside the target and renamed into place, so an upload that is
cancelled or drops halfway leaves nothing behind, and one that is replacing a file does not truncate
it until every byte has arrived.
*/
func (p Project) uploadContent(parentDir, relativePath string, replace bool, body io.Reader) (models.ContentModel, error) {
	fromBrowser := filepath.FromSlash(relativePath)
	relative := filepath.Clean(fromBrowser)
	name := filepath.Base(relative)
	// A trailing separator survives neither Clean nor Base, and it means the browser named a folder.
	if filepath.IsAbs(relative) || name == "." || name == ".." || strings.HasSuffix(fromBrowser, string(os.PathSeparator)) {
		return models.ContentModel{}, fmt.Errorf("%s is not a file name", relativePath)
	}

	// The whole target confirmed to be inside the project, not just its folder: `..` in the browser's
	// string is the reason this is not filepath.Join on its own.
	target, err := p.safeWritePath(filepath.Join(parentDir, relative))
	if err != nil {
		return models.ContentModel{}, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return models.ContentModel{}, err
	}

	if !replace && pathExists(target) {
		return models.ContentModel{}, errTargetExists
	}
	if target, err = p.throughLink(target); err != nil {
		return models.ContentModel{}, err
	}

	written, err := atomicfile.Write(target, body, 0o644)
	if err != nil {
		return models.ContentModel{}, err
	}
	log.Debug().Msgf("Uploaded %d bytes to %s", written, target)

	return createdModel(
		contentTypeFor(name, false),
		filepath.Join(parentDir, filepath.Dir(relative)),
		name,
		target,
	)
}
