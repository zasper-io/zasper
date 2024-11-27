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
