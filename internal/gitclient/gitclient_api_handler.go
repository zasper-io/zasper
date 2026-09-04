package gitclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-git/go-git/v5"

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

// repoForRead opens the repository, answering whenAbsent for a project that is not under git.
func repoForRead(w http.ResponseWriter, whenAbsent any) (*git.Repository, string, bool) {
	repo, root, err := openRepo()
	if notARepository(err) {
		sendJSON(w, whenAbsent)
		return nil, "", false
	}
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Could not open the repository: %v", err))
		return nil, "", false
	}
	return repo, root, true
}

/*
repoForWrite is the same for the endpoints that change something, where being asked to stage in a
directory that is not a repository — or on a machine with no git — is a refusal rather than a state to
render: the panel does not offer those buttons, so a request carrying one is already wrong.
*/
func repoForWrite(w http.ResponseWriter) (*git.Repository, string, bool) {
	if !Available() {
		zhttp.SendErrorResponse(w, http.StatusConflict, "Git is not installed, so this project cannot be changed from here.")
		return nil, "", false
	}

	repo, root, err := openRepo()
	if notARepository(err) {
		zhttp.SendErrorResponse(w, http.StatusConflict, "This project is not a git repository.")
		return nil, "", false
	}
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Could not open the repository: %v", err))
		return nil, "", false
	}
	return repo, root, true
}

/*
failed answers a write that did not work.

A git command that exits non-zero is nearly always something the user can fix — an unset user.email,
credentials the helper could not supply, a push behind its remote — so it is a 409 carrying git's own
stderr, and the panel shows that text. A 500 is kept for the things that really are the server's fault,
because a red "internal error" for a missing user.name sends people to the wrong place.
*/
func failed(w http.ResponseWriter, err error) {
	var fromGit *CommandError
	var refused *Refusal
	if errors.As(err, &fromGit) || errors.As(err, &refused) {
		zhttp.SendErrorResponse(w, http.StatusConflict, err.Error())
		return
	}
	zhttp.SendErrorResponse(w, http.StatusInternalServerError, err.Error())
}

// statusFor assembles the whole panel's state: what has changed, and where the branch stands.
func statusFor(ctx context.Context, repo *git.Repository, root string) (StatusResponse, error) {
	status, err := getStatus(repo)
	if err != nil {
		return status, err
	}

	status.Branch, err = getCurrentBranch(repo)
	if err != nil {
		return status, err
	}
	status.HasRemote = hasRemote(repo)
	status.Upstream, status.Ahead, status.Behind = syncState(ctx, root)

	return status, nil
}

// sendStatus answers with the state the repository is now in, so a stage or a commit does not need a
// second request to show its effect — and cannot show a status read before it happened.
func sendStatus(w http.ResponseWriter, r *http.Request, repo *git.Repository, root string) {
	status, err := statusFor(r.Context(), repo, root)
	if err != nil {
		failed(w, err)
		return
	}
	sendJSON(w, status)
}

func StatusHandler(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := repoForRead(w, newStatus())
	if !ok {
		return
	}
	sendStatus(w, r, repo, root)
}

func BranchHandler(w http.ResponseWriter, r *http.Request) {
	repo, _, ok := repoForRead(w, BranchResponse{})
	if !ok {
		return
	}

	branch, err := getCurrentBranch(repo)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error getting current branch: %v", err))
		return
	}

	sendJSON(w, BranchResponse{Branch: branch, IsRepository: true})
}

func CommitGraphHandler(w http.ResponseWriter, r *http.Request) {
	repo, _, ok := repoForRead(w, CommitGraphResponse{Commits: []Commit{}})
	if !ok {
		return
	}

	commits, err := getCommitGraph(repo)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error fetching commit graph: %v", err))
		return
	}

	sendJSON(w, CommitGraphResponse{Commits: commits, IsRepository: true})
}

// pathsRequest is what the three path-taking endpoints are given.
type pathsRequest struct {
	Paths []string `json:"paths"`
	// DeleteUntracked is the caller saying it knows a discard of an untracked file deletes it.
	DeleteUntracked bool `json:"deleteUntracked"`
}

// decodePaths reads the request and confines every path in it to the repository.
func decodePaths(w http.ResponseWriter, r *http.Request, root string) (pathsRequest, []string, bool) {
	var request pathsRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return request, nil, false
	}

	paths, err := relPaths(root, request.Paths)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return request, nil, false
	}
	return request, paths, true
}

func StageHandler(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := repoForWrite(w)
	if !ok {
		return
	}
	_, paths, ok := decodePaths(w, r, root)
	if !ok {
		return
	}

	if err := stage(r.Context(), root, paths); err != nil {
		failed(w, err)
		return
	}
	sendStatus(w, r, repo, root)
}

func UnstageHandler(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := repoForWrite(w)
	if !ok {
		return
	}
	_, paths, ok := decodePaths(w, r, root)
	if !ok {
		return
	}

	if err := unstage(r.Context(), repo, root, paths); err != nil {
		failed(w, err)
		return
	}
	sendStatus(w, r, repo, root)
}

func DiscardHandler(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := repoForWrite(w)
	if !ok {
		return
	}
	request, paths, ok := decodePaths(w, r, root)
	if !ok {
		return
	}

	if err := discard(r.Context(), repo, root, paths, request.DeleteUntracked); err != nil {
		failed(w, err)
		return
	}
	sendStatus(w, r, repo, root)
}

func CommitHandler(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := repoForWrite(w)
	if !ok {
		return
	}

	var request struct {
		Message string `json:"message"`
		Amend   bool   `json:"amend"`
		Push    bool   `json:"push"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}
	if request.Message == "" {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "A commit needs a message.")
		return
	}

	// Checked here rather than left to git, whose answer to it is "nothing added to commit but
	// untracked files present", which does not tell someone looking at a panel full of changes what
	// they are supposed to do about it.
	status, err := getStatus(repo)
	if err != nil {
		failed(w, err)
		return
	}
	if len(status.Staged) == 0 && !request.Amend {
		zhttp.SendErrorResponse(w, http.StatusConflict, "Nothing is staged. Stage a change before committing.")
		return
	}

	if err := commitStaged(r.Context(), root, request.Message, request.Amend); err != nil {
		failed(w, err)
		return
	}

	if request.Push {
		branch, err := getCurrentBranch(repo)
		if err != nil {
			failed(w, err)
			return
		}
		upstream, _, _ := syncState(r.Context(), root)
		if err := push(r.Context(), repo, root, branch, upstream); err != nil {
			// Said precisely, because the commit did happen: told only that it failed, the user
			// commits again and gets an empty second commit or an amend they did not mean.
			zhttp.SendErrorResponse(w, http.StatusConflict,
				fmt.Sprintf("The commit was made, but the push failed: %v", err))
			return
		}
	}
	sendStatus(w, r, repo, root)
}
