package gitclient

import (
	"encoding/json"
	"fmt"
	"net/http"

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

type BranchResponse struct {
	Branch string `json:"branch"`
}

func BranchHandler(w http.ResponseWriter, r *http.Request) {
	repoPath := core.Zasper.HomeDir
	branch, err := getCurrentBranch(repoPath)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error getting current branch: %v", err))
		return
	}

	response := BranchResponse{
		Branch: branch,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	err = json.NewEncoder(w).Encode(response)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error encoding JSON: %v", err))
	}
}

func CommitGraphHandler(w http.ResponseWriter, r *http.Request) {
	repoPath := core.Zasper.HomeDir

	commits, err := getCommitGraph(repoPath)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error fetching commit graph: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(commits)
}

func GetUncommittedFilesHandler(w http.ResponseWriter, r *http.Request) {

	repoPath := core.Zasper.HomeDir
	// Get uncommitted files
	uncommittedFiles, err := getUncommittedFiles(repoPath)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error getting uncommitted files: %v", err))
		return
	}

	// Return the list as a JSON response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(uncommittedFiles)
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
