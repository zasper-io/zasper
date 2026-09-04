package gitclient

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-git/go-git/v5"

	"github.com/zasper-io/zasper/internal/core"
	zhttp "github.com/zasper-io/zasper/internal/http"
)

type Commit struct {
	Hash    string   `json:"hash"`
	Message string   `json:"message"`
	Author  string   `json:"author"`
	Date    string   `json:"date"`
	Parents []string `json:"parents"` // Store the hashes of parent commits
}

/*
Every read below carries isRepository, because a project directory is not obliged to be under git and
the frontend has to render something either way. Answering 500 for that said the server was broken when
it was not, and put three red errors in the console of every session opened on a plain folder.
*/

type BranchResponse struct {
	Branch       string `json:"branch"`
	IsRepository bool   `json:"isRepository"`
}

type UncommittedFilesResponse struct {
	Files        []string `json:"files"`
	IsRepository bool     `json:"isRepository"`
}

type CommitGraphResponse struct {
	Commits      []Commit `json:"commits"`
	IsRepository bool     `json:"isRepository"`
}

// notARepository reports whether err is go-git saying there is nothing to open at the path.
func notARepository(err error) bool {
	return errors.Is(err, git.ErrRepositoryNotExists)
}

func sendJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	// The status is already written, so a failure here is the client having gone away rather than
	// anything this handler can answer differently.
	_ = json.NewEncoder(w).Encode(payload)
}

func BranchHandler(w http.ResponseWriter, r *http.Request) {
	branch, err := getCurrentBranch(core.Zasper.HomeDir)
	if notARepository(err) {
		sendJSON(w, BranchResponse{})
		return
	}
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error getting current branch: %v", err))
		return
	}

	sendJSON(w, BranchResponse{Branch: branch, IsRepository: true})
}

func CommitGraphHandler(w http.ResponseWriter, r *http.Request) {
	commits, err := getCommitGraph(core.Zasper.HomeDir)
	if notARepository(err) {
		sendJSON(w, CommitGraphResponse{Commits: []Commit{}})
		return
	}
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error fetching commit graph: %v", err))
		return
	}

	sendJSON(w, CommitGraphResponse{Commits: commits, IsRepository: true})
}

func GetUncommittedFilesHandler(w http.ResponseWriter, r *http.Request) {
	uncommittedFiles, err := getUncommittedFiles(core.Zasper.HomeDir)
	if notARepository(err) {
		sendJSON(w, UncommittedFilesResponse{Files: []string{}})
		return
	}
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error getting uncommitted files: %v", err))
		return
	}

	sendJSON(w, UncommittedFilesResponse{Files: uncommittedFiles, IsRepository: true})
}

// API handler to commit and optionally push changes
func CommitAndMaybePushHandler(w http.ResponseWriter, r *http.Request) {
	repoPath := core.Zasper.HomeDir
	var requestData struct {
		Message string   `json:"message"`
		Files   []string `json:"files"`
		Push    bool     `json:"push"` // Add a flag to determine whether to push
	}

	err := json.NewDecoder(r.Body).Decode(&requestData)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}

	// Commit the changes
	err = commitSpecificFiles(repoPath, requestData.Files, requestData.Message)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Failed to commit selected files: %v", err))
		return
	}

	// If 'push' is true, push the changes
	if requestData.Push {
		err = pushChanges(repoPath)
		if err != nil {
			zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Failed to push changes: %v", err))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Changes committed and pushed successfully"))
	} else {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Changes committed successfully"))
	}
}
