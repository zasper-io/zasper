package gitclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-git/go-git/v5"
	"github.com/gorilla/mux"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/httpx"
)

/*
Every read below carries isRepository, because a project directory is not obliged to be under git and
the frontend has to render something either way. Answering 500 for that said the server was broken when
it was not, and put three red errors in the console of every session opened on a plain folder.
*/

type BranchResponse struct {
	Branch       string `json:"branch"`
	IsRepository bool   `json:"isRepository"`
}

/*
LogResponse is one page of the history.

HasMore rather than a total: counting a history means walking all of it, which is what this endpoint was
changed to stop doing. The panel only needs to know whether to offer another page.
*/
type LogResponse struct {
	Commits      []Commit `json:"commits"`
	HasMore      bool     `json:"hasMore"`
	IsRepository bool     `json:"isRepository"`
}

type BranchesResponse struct {
	Branches     []Branch `json:"branches"`
	IsRepository bool     `json:"isRepository"`
}

// notARepository reports whether err is go-git saying there is nothing to open at the path.
func notARepository(err error) bool {
	return errors.Is(err, git.ErrRepositoryNotExists)
}

// repoForRead opens the repository, answering whenAbsent for a project that is not under git.
func (h *Handler) repoForRead(w http.ResponseWriter, whenAbsent any) (*git.Repository, string, bool) {
	repo, root, err := openRepo(h.projectDir)
	if notARepository(err) {
		httpx.SendJSON(w, http.StatusOK, whenAbsent)
		return nil, "", false
	}
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Could not open the repository: %v", err))
		return nil, "", false
	}
	return repo, root, true
}

/*
repoForWrite is the same for the endpoints that change something, where being asked to stage in a
directory that is not a repository — or on a machine with no git — is a refusal rather than a state to
render: the panel does not offer those buttons, so a request carrying one is already wrong.
*/
func (h *Handler) repoForWrite(w http.ResponseWriter) (*git.Repository, string, bool) {
	if !Available() {
		httpx.SendErrorResponse(w, http.StatusConflict, "Git is not installed, so this project cannot be changed from here.")
		return nil, "", false
	}

	repo, root, err := openRepo(h.projectDir)
	if notARepository(err) {
		httpx.SendErrorResponse(w, http.StatusConflict, "This project is not a git repository.")
		return nil, "", false
	}
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Could not open the repository: %v", err))
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
		httpx.SendErrorResponse(w, http.StatusConflict, err.Error())
		return
	}
	httpx.SendErrorResponse(w, http.StatusInternalServerError, err.Error())
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
	httpx.SendJSON(w, http.StatusOK, status)
}

func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := h.repoForRead(w, newStatus())
	if !ok {
		return
	}
	sendStatus(w, r, repo, root)
}

func (h *Handler) Branch(w http.ResponseWriter, r *http.Request) {
	repo, _, ok := h.repoForRead(w, BranchResponse{})
	if !ok {
		return
	}

	branch, err := getCurrentBranch(repo)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error getting current branch: %v", err))
		return
	}

	httpx.SendJSON(w, http.StatusOK, BranchResponse{Branch: branch, IsRepository: true})
}

/*
Log answers a page of the history.

Paged because the panel shows a screenful and the old endpoint walked to the root commit for every read
— on every commit, pull and branch switch, in a repository as long as this one's.
*/
func (h *Handler) Log(w http.ResponseWriter, r *http.Request) {
	repo, _, ok := h.repoForRead(w, LogResponse{Commits: []Commit{}})
	if !ok {
		return
	}

	limit := intParam(r, "limit", defaultLogLimit, 1, maxLogLimit)
	skip := intParam(r, "skip", 0, 0, 0)

	commits, hasMore, err := getLog(repo, limit, skip)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error reading the history: %v", err))
		return
	}

	httpx.SendJSON(w, http.StatusOK, LogResponse{Commits: commits, HasMore: hasMore, IsRepository: true})
}

/*
intParam reads a bounded number from the query.

Bounded rather than trusted: limit is how many commits this process assembles into one response, so a
request asking for a hundred million of them is a request to walk the whole history — the thing paging is
here to prevent. A value that will not parse is the default rather than a 400, since a missing page size
is not worth failing a read over. max of 0 means no ceiling, which is right for an offset.
*/
func intParam(r *http.Request, name string, fallback, min, max int) int {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	if value < min {
		return min
	}
	if max > 0 && value > max {
		return max
	}
	return value
}

/*
CommitDetail answers with one commit and the files in it, which is what a row of the history
expands into.

The one read that does not carry isRepository: an empty commit is not a state to render, and nothing asks
about a commit it did not just see in a history read from this same repository. So a project that is not
under git is a 404 here like any other commit that is not there.
*/
func (h *Handler) CommitDetail(w http.ResponseWriter, r *http.Request) {
	repo, _, err := openRepo(h.projectDir)
	if notARepository(err) {
		httpx.SendErrorResponse(w, http.StatusNotFound, "This project is not a git repository.")
		return
	}
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Could not open the repository: %v", err))
		return
	}

	detail, err := getCommitDetail(r.Context(), repo, mux.Vars(r)["hash"])
	var missing *notFound
	if errors.As(err, &missing) {
		// The one read here that is genuinely absent rather than empty: a panel left open across a rebase
		// asks about commits that no longer exist, and that is a 404 rather than a fault.
		httpx.SendErrorResponse(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error reading the commit: %v", err))
		return
	}

	httpx.SendJSON(w, http.StatusOK, detail)
}

/*
Init makes the project a repository.

Run rather than reimplemented with go-git so init.defaultBranch is honoured — go-git's PlainInit hardcodes
master, and a project whose first branch is not the one every other tool on the machine would have made is
a surprise nobody asked this panel for. Templates and hooks come along for the same reason.
*/
func (h *Handler) Init(w http.ResponseWriter, r *http.Request) {
	if !Available() {
		httpx.SendErrorResponse(w, http.StatusConflict, "Git is not installed, so a repository cannot be created from here.")
		return
	}

	_, _, err := openRepo(h.projectDir)
	if err == nil {
		// Including a project inside someone else's checkout, where this would make a second repository
		// nested in the first. The panel does not offer the button in that case; a request carrying it is
		// stale.
		httpx.SendErrorResponse(w, http.StatusConflict, "This project is already in a git repository.")
		return
	}
	if !notARepository(err) {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Could not open the repository: %v", err))
		return
	}

	if err := initRepository(r.Context(), h.projectDir); err != nil {
		failed(w, err)
		return
	}

	repo, root, err := openRepo(h.projectDir)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("The repository was created but could not be opened: %v", err))
		return
	}
	sendStatus(w, r, repo, root)
}

/*
Diff answers the two sides of one file's comparison.

Not a repository is a 404 here rather than a state to render, for the same reason as CommitDetail:
nothing asks for a diff except a panel that has just been shown the file in a status or a commit read
from this same repository.
*/
func (h *Handler) Diff(w http.ResponseWriter, r *http.Request) {
	repo, root, err := openRepo(h.projectDir)
	if notARepository(err) {
		httpx.SendErrorResponse(w, http.StatusNotFound, "This project is not a git repository.")
		return
	}
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Could not open the repository: %v", err))
		return
	}

	query := r.URL.Query()
	path, err := relPath(root, query.Get("path"))
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	// Confined like any other path from a request: it names the original side, so it reads a blob.
	from := ""
	if raw := query.Get("from"); raw != "" {
		if from, err = relPath(root, raw); err != nil {
			httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	diff, err := getDiff(repo, root, path, from, query.Get("staged") == "true", query.Get("ref"))
	var missing *missingPath
	var unknown *notFound
	if errors.As(err, &missing) || errors.As(err, &unknown) {
		httpx.SendErrorResponse(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error reading the comparison: %v", err))
		return
	}

	httpx.SendJSON(w, http.StatusOK, diff)
}

func (h *Handler) Branches(w http.ResponseWriter, r *http.Request) {
	repo, _, ok := h.repoForRead(w, BranchesResponse{Branches: []Branch{}})
	if !ok {
		return
	}

	branches, err := getBranches(repo)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error listing branches: %v", err))
		return
	}

	httpx.SendJSON(w, http.StatusOK, BranchesResponse{Branches: branches, IsRepository: true})
}

func (h *Handler) Checkout(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := h.repoForWrite(w)
	if !ok {
		return
	}

	var request struct {
		Branch string `json:"branch"`
		Create bool   `json:"create"`
		// From is what a new branch starts at — a branch, a tag or a commit. Empty means the commit
		// that is checked out, which is what `git checkout -b` does on its own.
		From string `json:"from"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}

	if err := checkout(r.Context(), repo, root, request.Branch, request.Create, request.From); err != nil {
		failed(w, err)
		return
	}
	sendStatus(w, r, repo, root)
}

/*
DeleteBranch takes the branch in the body rather than in the path.

A branch is called `feature/thing` as often as not, and a name with a slash in it cannot be a path segment
without encoding a slash — which proxies and routers are entitled to decode again before this handler sees
it. The content API already deletes with a body for the same reason.
*/
func (h *Handler) DeleteBranch(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := h.repoForWrite(w)
	if !ok {
		return
	}

	var request struct {
		Name string `json:"name"`
		// Force is the caller having been told the branch has commits nowhere else, and meaning it.
		Force bool `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}

	if err := deleteBranch(r.Context(), repo, root, request.Name, request.Force); err != nil {
		failed(w, err)
		return
	}
	sendStatus(w, r, repo, root)
}

// The three remote endpoints take no body: which branch and which remote are the repository's own
// business, and a panel that let the browser choose them would be a worse `git push`.

func (h *Handler) Fetch(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := h.repoForWrite(w)
	if !ok {
		return
	}

	if err := fetch(r.Context(), repo, root); err != nil {
		failed(w, err)
		return
	}
	// The point of a fetch is the ahead/behind counts this recomputes; nothing else about it is visible.
	sendStatus(w, r, repo, root)
}

func (h *Handler) Pull(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := h.repoForWrite(w)
	if !ok {
		return
	}

	if err := pull(r.Context(), repo, root); err != nil {
		failed(w, err)
		return
	}
	sendStatus(w, r, repo, root)
}

func (h *Handler) Push(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := h.repoForWrite(w)
	if !ok {
		return
	}

	if err := pushCurrent(r.Context(), repo, root); err != nil {
		failed(w, err)
		return
	}
	sendStatus(w, r, repo, root)
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
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return request, nil, false
	}

	paths, err := relPaths(root, request.Paths)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return request, nil, false
	}
	return request, paths, true
}

func (h *Handler) Stage(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := h.repoForWrite(w)
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

func (h *Handler) Unstage(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := h.repoForWrite(w)
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

func (h *Handler) Discard(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := h.repoForWrite(w)
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

func (h *Handler) Commit(w http.ResponseWriter, r *http.Request) {
	repo, root, ok := h.repoForWrite(w)
	if !ok {
		return
	}

	var request struct {
		Message string `json:"message"`
		Amend   bool   `json:"amend"`
		Push    bool   `json:"push"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}
	if request.Message == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "A commit needs a message.")
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
		httpx.SendErrorResponse(w, http.StatusConflict, "Nothing is staged. Stage a change before committing.")
		return
	}

	if err := commitStaged(r.Context(), root, request.Message, request.Amend); err != nil {
		failed(w, err)
		return
	}

	if request.Push {
		if err := pushCurrent(r.Context(), repo, root); err != nil {
			// Said precisely, because the commit did happen: told only that it failed, the user
			// commits again and gets an empty second commit or an amend they did not mean.
			httpx.SendErrorResponse(w, http.StatusConflict,
				fmt.Sprintf("The commit was made, but the push failed: %v", err))
			return
		}
	}
	sendStatus(w, r, repo, root)
}

/*
Tracked counts one git operation, named here rather than inside the handler so that the handlers stay
unaware of telemetry and the route table stays the list of what is counted.

Only the writes are wrapped. The panel polls status and current-branch, so counting those would bury
everything else under them.
*/
func Tracked(operation string, handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		recorder := httpx.NewResponseRecorder(w)
		handler(recorder, req)
		if recorder.Status < http.StatusBadRequest {
			analytics.Track(analytics.EventGitOperation, map[string]interface{}{"operation": operation})
		}
	}
}
