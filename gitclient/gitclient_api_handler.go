package gitclient

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/zasper-io/zasper/core"
)

type Commit struct {
	Hash    string   `json:"hash"`
	Message string   `json:"message"`
	Author  string   `json:"author"`
	Date    string   `json:"date"`
	Parents []string `json:"parents"` // Store the hashes of parent commits
}

// Response structure to return as JSON
type BranchResponse struct {
	Branch string `json:"branch"`
}

func BranchHandler(w http.ResponseWriter, r *http.Request) {
	repoPath := core.Zasper.HomeDir
	// Get the current active branch
	branch, err := getCurrentBranch(repoPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error getting current branch: %v", err), http.StatusInternalServerError)
		return
	}

	// Create a response struct
	response := BranchResponse{
		Branch: branch,
	}

	// Set the response header to indicate JSON content
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	// Encode the response struct as JSON and write it to the response
	err = json.NewEncoder(w).Encode(response)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error encoding JSON: %v", err), http.StatusInternalServerError)
	}
}

func CommitGraphHandler(w http.ResponseWriter, r *http.Request) {
	repoPath := core.Zasper.HomeDir

	commits, err := getCommitGraph(repoPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error fetching commit graph: %v", err), http.StatusInternalServerError)
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
		http.Error(w, "Failed to get uncommitted files", http.StatusInternalServerError)
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
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Commit the changes
	err = commitSpecificFiles(repoPath, requestData.Files, requestData.Message)
	if err != nil {
		http.Error(w, "Failed to commit selected files", http.StatusInternalServerError)
		return
	}

	// If 'push' is true, push the changes
	if requestData.Push {
		err = pushChanges(repoPath)
		if err != nil {
			http.Error(w, "Failed to push changes", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Changes committed and pushed successfully"))
	} else {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Changes committed successfully"))
	}
}
