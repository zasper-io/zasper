package content

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/zasper-io/zasper/internal/models"
	"github.com/zasper-io/zasper/internal/nbformat"
)

/*
Creating something can fail — a read-only filesystem, a full disk, a parent directory that has just
gone — and the client shows the new row by the path in the answer, so a failure that answered 200
with a model for a file that is not there left the panel lying.
*/
func (p Project) createContent(payload ContentPayload) (models.ContentModel, error) {
	switch payload.ContentType {
	case "notebook":
		return p.newUntitledNotebook(payload)
	case "directory":
		return p.CreateDirectory(payload)
	default:
		return p.newUntitledFile(payload)
	}
}

// pathExists is about anything answering to the path, a broken symlink included: a name is free only
// when nothing at all is there.
func pathExists(osPath string) bool {
	_, err := os.Lstat(osPath)
	return err == nil
}

// availableName returns the first candidate that names nothing in osDir. Racy by nature, which is
// why the creators still open with O_EXCL rather than trusting the answer.
func availableName(osDir string, candidate func(attempt int) string) string {
	for attempt := 0; ; attempt++ {
		name := candidate(attempt)
		if !pathExists(filepath.Join(osDir, name)) {
			return name
		}
	}
}

// numbered names the first attempt plainly and every later one with a number, which is how both
// Jupyter's `Untitled1.ipynb` and this project's `untitled-directory-1` are spelled.
func numbered(base, separator, ext string) func(int) string {
	return func(attempt int) string {
		if attempt == 0 {
			return base + ext
		}
		return fmt.Sprintf("%s%s%d%s", base, separator, attempt, ext)
	}
}

// createdModel describes what was just written, from the file itself rather than from what was asked
// for: the path is project-relative like every other path in the API, since the client looks the new
// row up in the listing by it, and the name is the one that was free.
func createdModel(contentType, parentDir, name, osPath string) (models.ContentModel, error) {
	info, err := os.Lstat(osPath)
	if err != nil {
		return models.ContentModel{}, err
	}

	return models.ContentModel{
		ContentType:  contentType,
		Path:         filepath.Join(parentDir, name),
		Name:         name,
		Created:      info.ModTime().UTC().Format(time.RFC3339),
		LastModified: info.ModTime().UTC().Format(time.RFC3339),
		Size:         info.Size(),
		// Asked rather than assumed: a directory listing reports this, so an entry that has just been
		// created should describe itself the same way rather than claiming to be read-only.
		Writable: isWritable(osPath, info),
	}, nil
}

func (p Project) newUntitledFile(payload ContentPayload) (models.ContentModel, error) {
	parentDir, err := p.safeWritePath(payload.ParentDir)
	if err != nil {
		return models.ContentModel{}, err
	}

	name := availableName(parentDir, numbered("untitled", "", ".txt"))
	osPath := filepath.Join(parentDir, name)

	// O_EXCL rather than O_TRUNC: availableName looked a moment ago, and truncating a file that has
	// appeared since would destroy it.
	file, err := os.OpenFile(osPath, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0644)
	if err != nil {
		return models.ContentModel{}, err
	}
	if err := file.Close(); err != nil {
		return models.ContentModel{}, err
	}

	return createdModel(payload.ContentType, payload.ParentDir, name, osPath)
}

func (p Project) newUntitledNotebook(payload ContentPayload) (models.ContentModel, error) {
	parentDir, err := p.safeWritePath(payload.ParentDir)
	if err != nil {
		return models.ContentModel{}, err
	}

	defaultNotebook, err := nbformat.Marshal(nbformat.New())
	if err != nil {
		return models.ContentModel{}, fmt.Errorf("building the default notebook: %w", err)
	}

	name := availableName(parentDir, numbered("Untitled", "", ".ipynb"))
	osPath := filepath.Join(parentDir, name)

	file, err := os.OpenFile(osPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err != nil {
		return models.ContentModel{}, err
	}
	if _, err := file.Write(defaultNotebook); err != nil {
		file.Close()
		return models.ContentModel{}, err
	}
	if err := file.Close(); err != nil {
		return models.ContentModel{}, err
	}

	return createdModel(payload.ContentType, payload.ParentDir, name, osPath)
}

func (p Project) CreateDirectory(payload ContentPayload) (models.ContentModel, error) {
	parentDir, err := p.safeWritePath(payload.ParentDir)
	if err != nil {
		return models.ContentModel{}, err
	}

	name := availableName(parentDir, numbered("untitled-directory", "-", ""))
	osPath := filepath.Join(parentDir, name)
	if err := os.Mkdir(osPath, 0755); err != nil {
		return models.ContentModel{}, err
	}

	return createdModel(payload.ContentType, payload.ParentDir, name, osPath)
}
