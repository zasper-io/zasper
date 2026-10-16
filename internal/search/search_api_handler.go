package search

import (
	"io/fs"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/httpx"
	"github.com/zasper-io/zasper/internal/models"
)

/*
How long one walk of the project answers searches for. The palette asks again on every keystroke, so a
word typed is one walk rather than one per letter; a file created since appears once this has passed.
*/
const listingTTL = 10 * time.Second

// The most suggestions one answer carries: the palette shows a screenful, and a one-letter query in a
// large project would otherwise send every file in it.
const maxSuggestions = 500

// The most ignored files a listing that includes them holds: an ignored folder can hold a dataset of a
// million files, and the walk goes no further into ignored folders once it has this many.
const maxIgnoredListing = 100_000

type projectFile struct {
	name     string
	path     string
	modified time.Time
	// What .gitignore leaves out, in a listing that includes it.
	ignored bool
}

type listing struct {
	files []projectFile
	at    time.Time
}

// Handler answers file suggestions for one project, from a listing of its files that is walked again once it
// is older than ttl.
type Handler struct {
	project content.Project
	ttl     time.Duration
	// The ripgrep a content search uses, or "" to search without it.
	ripgrep string

	mu sync.Mutex
	// By whether they include what .gitignore leaves out.
	listings map[bool]*listing
}

// NewHandler suggests the files of project.
func NewHandler(project content.Project) *Handler {
	ripgrep, _ := exec.LookPath("rg")
	return &Handler{project: project, ttl: listingTTL, ripgrep: ripgrep, listings: map[bool]*listing{}}
}

// projectFiles answers the project's files, walking it only when the last walk is older than ttl. Requests
// that arrive during a walk wait for it rather than starting walks of their own.
func (h *Handler) projectFiles(withIgnored bool) []projectFile {
	h.mu.Lock()
	defer h.mu.Unlock()

	found := h.listings[withIgnored]
	if found == nil || time.Since(found.at) >= h.ttl {
		found = &listing{files: walkProject(h.project.Root(), withIgnored), at: time.Now()}
		h.listings[withIgnored] = found
	}
	return found.files
}

/*
walkProject lists the project's files, leaving out what content.ProjectIgnores skips: generated folders
such as .git and node_modules, and whatever the project's .gitignore files ignore. withIgnored keeps what
.gitignore ignores, marked so, up to maxIgnoredListing of them; the generated folders stay out. A folder
that cannot be read is passed over rather than failing the whole search.
*/
func walkProject(root string, withIgnored bool) []projectFile {
	ignores := content.NewProjectIgnores(root)
	files := []projectFile{}
	// The ignored folders being walked into, whose files are ignored whatever .gitignore says of each.
	var inIgnored []string
	ignoredCount := 0

	filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			log.Debug().Err(err).Str("path", path).Msg("not searching a folder that cannot be read")
			return nil
		}
		if path == root {
			return nil
		}
		for len(inIgnored) > 0 && !strings.HasPrefix(path, inIgnored[len(inIgnored)-1]+string(filepath.Separator)) {
			inIgnored = inIgnored[:len(inIgnored)-1]
		}
		ignored := len(inIgnored) > 0 || ignores.Skips(path, entry.IsDir())
		tooMany := ignoredCount >= maxIgnoredListing
		if ignored && (!withIgnored || tooMany || (entry.IsDir() && content.IsSkippedFolder(entry.Name()))) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if ignored {
				inIgnored = append(inIgnored, path)
			}
			return nil
		}
		if ignored {
			ignoredCount++
		}

		info, err := entry.Info()
		if err != nil {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		files = append(files, projectFile{name: entry.Name(), path: filepath.ToSlash(relative), modified: info.ModTime(), ignored: ignored})
		return nil
	})
	return files
}

// Files answers the project's files whose name contains the query, whatever its case. With ignored=true,
// what .gitignore leaves out is offered too, marked so and after the rest; with match=path, a file whose
// path contains it is offered after those whose name does.
func (h *Handler) Files(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("query")
	if query == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Query parameter is required")
		return
	}

	// Case-insensitively: the palette matches its commands that way, and one query box whose two halves
	// disagree about whether `README` and `readme` are the same word is a bug report.
	needle := strings.ToLower(query)
	withIgnored := r.URL.Query().Get("ignored") == "true"
	inPaths := r.URL.Query().Get("match") == "path"
	files := h.projectFiles(withIgnored)
	// A file whose name matches comes before one whose folders alone do, and both before what
	// .gitignore leaves out.
	rank := func(file projectFile) int {
		switch {
		case strings.Contains(strings.ToLower(file.name), needle):
			return 0
		case inPaths && strings.Contains(strings.ToLower(file.path), needle):
			return 1
		}
		return -1
	}
	suggestions := []models.ContentModel{}
	type pass struct {
		ignored bool
		rank    int
	}
	for _, wanted := range []pass{{false, 0}, {false, 1}, {true, 0}, {true, 1}} {
		for _, file := range files {
			if len(suggestions) == maxSuggestions {
				break
			}
			if file.ignored != wanted.ignored || rank(file) != wanted.rank {
				continue
			}
			suggestions = append(suggestions, models.ContentModel{
				ContentType:  fileType(file.name),
				Name:         file.name,
				Path:         file.path,
				LastModified: file.modified.UTC().Format(time.RFC3339),
				Ignored:      file.ignored,
			})
		}
	}
	httpx.SendJSON(w, http.StatusOK, suggestions)
}

func fileType(name string) string {
	if filepath.Ext(name) == ".ipynb" {
		return "notebook"
	}
	return "file"
}
