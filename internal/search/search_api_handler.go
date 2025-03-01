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

	// Check cache first
	if cachedResults, found := cache.Load(query); found {
		// Check if cache has expired
		cacheData := cachedResults.(FileCache)
		if time.Since(cacheData.timestamp) < cacheExpiry {
			// Return cached results if still valid
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(cacheData.data)
			return
		}
	}

	// Proceed with the search logic if no valid cache
	directory := core.Zasper.HomeDir

	suggestions := []models.ContentModel{}

	// Walk through the directory tree recursively
	err := filepath.Walk(directory, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip directories, we only want files
		if info.IsDir() || strings.Contains(path, ".git") {
			return nil
		}

		// Check if the file name contains the query
		if strings.Contains(info.Name(), query) {

			relPath, _ := getRelativePath(path)

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
	cache.Store(query, FileCache{
		data:      suggestions,
		timestamp: time.Now(),
	})

	// Return the matching file names as a JSON response
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(suggestions); err != nil {
		http.Error(w, fmt.Sprintf("Error encoding response: %v", err), http.StatusInternalServerError)
	}
}
