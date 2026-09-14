package search

import (
	"io/fs"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/content"
	zhttp "github.com/zasper-io/zasper/internal/http"
	"github.com/zasper-io/zasper/internal/models"
)

/*
How long one walk of the project answers searches for. The palette asks again on every keystroke, so a
word typed is one walk rather than one per letter; a file created since appears once this has passed.
*/
var listingTTL = 10 * time.Second

// The most suggestions one answer carries: the palette shows a screenful, and a one-letter query in a
// large project would otherwise send every file in it.
const maxSuggestions = 500

type projectFile struct {
	name     string
	path     string
	modified time.Time
}

// listing is the most recent walk: one project's files, and when they were read.
var listing struct {
	mu    sync.Mutex
	root  string
	files []projectFile
	at    time.Time
}

// projectFiles answers the files of the project at root, walking it only when the last walk was of
// another project or is older than listingTTL. Requests that arrive during a walk wait for it rather than
// starting walks of their own.
func projectFiles(root string) []projectFile {
	listing.mu.Lock()
	defer listing.mu.Unlock()

	if listing.root != root || time.Since(listing.at) >= listingTTL {
		listing.root, listing.files, listing.at = root, walkProject(root), time.Now()
	}
	return listing.files
}

/*
walkProject lists the project's files, leaving out what content.ProjectIgnores skips: generated folders
such as .git and node_modules, and whatever the project's .gitignore files ignore. A folder that cannot be
read is passed over rather than failing the whole search.
*/
func walkProject(root string) []projectFile {
	ignores := content.NewProjectIgnores(root)
	files := []projectFile{}

	filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			log.Debug().Err(err).Str("path", path).Msg("not searching a folder that cannot be read")
			return nil
		}
		if path == root {
			return nil
		}
		if ignores.Skips(path, entry.IsDir()) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}

		info, err := entry.Info()
		if err != nil {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		files = append(files, projectFile{name: entry.Name(), path: filepath.ToSlash(relative), modified: info.ModTime()})
		return nil
	})
	return files
}

// GetFileSuggestions answers the project's files whose name contains the query, whatever its case.
func GetFileSuggestions(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("query")
	if query == "" {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Query parameter is required")
		return
	}

	// Case-insensitively: the palette matches its commands that way, and one query box whose two halves
	// disagree about whether `README` and `readme` are the same word is a bug report.
	needle := strings.ToLower(query)
	suggestions := []models.ContentModel{}
	for _, file := range projectFiles(content.GetSafePath(".")) {
		if !strings.Contains(strings.ToLower(file.name), needle) {
			continue
		}
		suggestions = append(suggestions, models.ContentModel{
			ContentType:  fileType(file.name),
			Name:         file.name,
			Path:         file.path,
			LastModified: file.modified.UTC().Format(time.RFC3339),
		})
		if len(suggestions) == maxSuggestions {
			break
		}
	}

	zhttp.SendJSON(w, http.StatusOK, suggestions)
}

func fileType(name string) string {
	if filepath.Ext(name) == ".ipynb" {
		return "notebook"
	}
	return "file"
}
