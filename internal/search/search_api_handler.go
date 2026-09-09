package search

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/models"
)

// Cache structure with expiration time
type FileCache struct {
	data      []models.ContentModel
	timestamp time.Time
}

// In-memory cache for file search results (sync.Map for concurrency safety)
var cache sync.Map

// Cache expiry time (e.g., 5 minutes)
var cacheExpiry = 5 * time.Minute

/*
How many answers are kept at once.

There has to be a limit because the key is the query, and the query is whatever the caller typed:
expiry is only consulted when an entry is read again, so an entry nobody asks for twice is never
removed and the map grew for the life of the process. The cache is here to save the second keystroke
of one search rather than to remember a session, so the whole thing is dropped on reaching the limit
instead of the oldest entry being tracked.
*/
const maxCachedQueries = 128

// cacheKey names the project as well as the query. The two are not separable: the same word means
// different files in different projects, and the store outlives a change of project.
func cacheKey(projectDir, query string) string {
	return projectDir + "\x00" + query
}

func getRelativePath(targetPath string) (string, error) {
	relPath, err := filepath.Rel(core.Zasper.HomeDir, targetPath)
	if err != nil {
		return "", err
	}
	return relPath, nil
}

// Function to check and collect files from the directory tree recursively, with caching
func GetFileSuggestions(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("query")
	if query == "" {
		http.Error(w, "Query parameter is required", http.StatusBadRequest)
		return
	}

	// Proceed with the search logic if no valid cache
	directory := core.Zasper.HomeDir
	key := cacheKey(directory, query)

	// Check cache first
	if cachedResults, found := cache.Load(key); found {
		// Comma-ok: nothing else writes to this map today, and a bare assertion is how that stops
		// being true quietly.
		cacheData, ok := cachedResults.(FileCache)
		if ok && time.Since(cacheData.timestamp) < cacheExpiry {
			// Return cached results if still valid
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(cacheData.data)
			return
		}
	}

	suggestions := []models.ContentModel{}

	// Walk through the directory tree recursively
	err := filepath.Walk(directory, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip directories, we only want files
		if info.IsDir() {
			return nil
		}
		// Git's own directory, matched as a whole path segment. `strings.Contains(path, ".git")`
		// was also hiding .gitignore, .gitattributes and everything under .github/.
		if insideGitDir(directory, path) {
			return nil
		}

		// Case-insensitively: the palette matches its commands that way, and one query box whose two
		// halves disagree about whether `README` and `readme` are the same word is a bug report.
		if strings.Contains(strings.ToLower(info.Name()), strings.ToLower(query)) {

			relPath, err := getRelativePath(path)
			if err != nil {
				// Nothing useful can be said about a file the client cannot ask for by path, so it
				// is left out rather than offered with an empty one.
				return nil
			}

			suggestion := models.ContentModel{
				ContentType:   "file",
				Name:          info.Name(),
				Path:          relPath,
				Last_modified: info.ModTime().GoString(),
			}

			// Add the file to the suggestions list
			suggestions = append(suggestions, suggestion)

		}

		return nil
	})

	// If there was an error during the walk, return it
	if err != nil {
		http.Error(w, fmt.Sprintf("Error walking the directory tree: %v", err), http.StatusInternalServerError)
		return
	}

	// Cache the result (along with the current timestamp)
	rememberSuggestions(key, suggestions)

	// Return the matching file names as a JSON response
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(suggestions); err != nil {
		http.Error(w, fmt.Sprintf("Error encoding response: %v", err), http.StatusInternalServerError)
	}
}

// insideGitDir reports whether path sits inside the project's own .git directory.
func insideGitDir(projectDir, path string) bool {
	relative, err := filepath.Rel(projectDir, path)
	if err != nil {
		return false
	}
	for _, segment := range strings.Split(filepath.ToSlash(relative), "/") {
		if segment == ".git" {
			return true
		}
	}
	return false
}

// rememberSuggestions stores an answer, emptying the cache first if it has reached its limit.
func rememberSuggestions(key string, suggestions []models.ContentModel) {
	held := 0
	cache.Range(func(_, _ any) bool {
		held++
		return held < maxCachedQueries
	})
	if held >= maxCachedQueries {
		cache.Clear()
	}

	cache.Store(key, FileCache{
		data:      suggestions,
		timestamp: time.Now(),
	})
}
