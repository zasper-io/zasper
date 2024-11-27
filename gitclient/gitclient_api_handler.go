package gitclient

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"
)

type Commit struct {
	Hash    string   `json:"hash"`
	Message string   `json:"message"`
	Author  string   `json:"author"`
	Date    string   `json:"date"`
	Parents []string `json:"parents"` // Store the hashes of parent commits
}

func getCommitGraph(repoPath string) ([]Commit, error) {
	// Open existing git repository
	repo, err := git.PlainOpen(repoPath)
	if err != nil {
		return nil, err
	}

	// Get the HEAD reference to start from the latest commit
	ref, err := repo.Head()
	if err != nil {
		return nil, err
	}

	// Traverse through the commit history
	commitIter, err := repo.Log(&git.LogOptions{From: ref.Hash()})
	if err != nil {
		return nil, err
	}

	var commits []Commit
	err = commitIter.ForEach(func(c *object.Commit) error {
		// commit data (hash, message, author, date, parents)
		parents := make([]string, len(c.ParentHashes))
		for i, parentHash := range c.ParentHashes {
			parents[i] = parentHash.String()
		}

		commit := Commit{
			Hash:    c.Hash.String(),
			Message: c.Message,
			Author:  c.Author.Name,
			Date:    c.Author.When.String(),
			Parents: parents,
		}

		commits = append(commits, commit)
		return nil
	})

	if err != nil {
		return nil, err
	}

	return commits, nil
}

// Function to get a list of uncommitted files
func getUncommittedFiles(repoPath string) ([]string, error) {
	// Open the git repository
	repo, err := git.PlainOpen(repoPath)
	if err != nil {
		return nil, err
	}

	// Get the current working tree
	w, err := repo.Worktree()
	if err != nil {
		return nil, err
	}

	// Get the status of the files in the repository
	status, err := w.Status()
	if err != nil {
		return nil, err
	}

	// Collect the list of modified or untracked files
	var uncommittedFiles []string
	for file, state := range status {
		if state.Worktree != git.Unmodified { // Filter out unmodified files
			uncommittedFiles = append(uncommittedFiles, file)
		}
	}

	return uncommittedFiles, nil
}

// Function to commit specific files
func commitSpecificFiles(repoPath string, files []string, message string) error {
	// Open the git repository
	repo, err := git.PlainOpen(repoPath)
	if err != nil {
		return err
	}

	// Get the current working tree
	w, err := repo.Worktree()
	if err != nil {
		return err
	}

	// Add the selected files
	for _, file := range files {
		_, err = w.Add(file)
		if err != nil {
			return fmt.Errorf("failed to add file %s: %v", file, err)
		}
	}

	// Commit the changes
	_, err = w.Commit(message, &git.CommitOptions{
		All: true,
	})
	if err != nil {
		return err
	}

	return nil
}

func CommitGraphHandler(w http.ResponseWriter, r *http.Request) {
	repoPath := "/Users/prasunanand/dev/zasper" // todo - get from config

	commits, err := getCommitGraph(repoPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error fetching commit graph: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(commits)
}

func GetUncommittedFilesHandler(w http.ResponseWriter, r *http.Request) {

	repoPath := "/Users/prasunanand/dev/zasper" // todo - get from config
	// Get uncommitted files
	uncommittedFiles, err := getUncommittedFiles(repoPath)
	if err != nil {
		http.Error(w, "Failed to get uncommitted files", http.StatusInternalServerError)
		return
	}

	// Return the list as a JSON response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(uncommittedFiles)
}

func CommitSpecificFilesHandler(w http.ResponseWriter, r *http.Request) {
	repoPath := "/Users/prasunanand/dev/zasper" // todo - get from config
	var requestData struct {
		Message string   `json:"message"`
		Files   []string `json:"files"`
	}

	err := json.NewDecoder(r.Body).Decode(&requestData)
	if err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	err = commitSpecificFiles(repoPath, requestData.Files, requestData.Message)
	if err != nil {
		http.Error(w, "Failed to commit selected files", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Selected files committed successfully"))
}
