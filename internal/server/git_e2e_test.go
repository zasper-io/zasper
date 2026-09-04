/*
The git endpoints, over a project directory in each of the three states one can be in: not a repository
at all, a repository with nothing committed yet, and a repository with history.

The first of those is what most of the read tests are about. The Git panel asks for the status and the
history on boot, so whatever those answer for a plain folder is what every session opened on one sees.
The rest are journeys through the index — stage, commit, unstage, discard, push — because staging is
what the panel is for and every step of it used to be either missing or wrong.
*/
package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/gitclient"
)

// getJSON reads one of the git endpoints, requiring the 200 that all of them owe a caller.
func getJSON[T any](t *testing.T, srv *httptest.Server, path string) T {
	t.Helper()

	status, body := call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status, "%s answered %d: %s", path, status, body)
	return decode[T](t, body)
}

// gitStatus is the whole panel state, which is also what every write answers with.
func gitStatus(t *testing.T, srv *httptest.Server) gitclient.StatusResponse {
	t.Helper()
	return getJSON[gitclient.StatusResponse](t, srv, "/api/git/status")
}

// post sends one of the write endpoints and requires it to have worked, answering with the status it
// came back with — so a journey does not have to re-read the status between its steps.
func post(t *testing.T, srv *httptest.Server, path string, payload any) gitclient.StatusResponse {
	t.Helper()

	status, body := call(t, srv, http.MethodPost, path, payload)
	require.Equal(t, http.StatusOK, status, "%s answered %d: %s", path, status, body)
	return decode[gitclient.StatusResponse](t, body)
}

// del is post for the one endpoint that deletes, which takes its subject in the body because a branch is
// called feature/thing as often as not and a slash cannot be half of a path segment.
func del(t *testing.T, srv *httptest.Server, path string, payload any) gitclient.StatusResponse {
	t.Helper()

	status, body := call(t, srv, http.MethodDelete, path, payload)
	require.Equal(t, http.StatusOK, status, "%s answered %d: %s", path, status, body)
	return decode[gitclient.StatusResponse](t, body)
}

// branches is the list the branch menu is drawn from.
func branches(t *testing.T, srv *httptest.Server) []gitclient.Branch {
	t.Helper()
	return getJSON[gitclient.BranchesResponse](t, srv, "/api/git/branches").Branches
}

// history is one page of the log, which is how the panel reads it: query and all, since the paging is
// half of what these tests are about.
func history(t *testing.T, srv *httptest.Server, query string) gitclient.LogResponse {
	t.Helper()
	return getJSON[gitclient.LogResponse](t, srv, "/api/git/log"+query)
}

// commitDetail is what a row of the history expands into.
func commitDetail(t *testing.T, srv *httptest.Server, hash string) gitclient.CommitDetail {
	t.Helper()
	return getJSON[gitclient.CommitDetail](t, srv, "/api/git/commit/"+hash)
}

func subjects(commits []gitclient.Commit) []string {
	lines := make([]string, 0, len(commits))
	for _, commit := range commits {
		lines = append(lines, commit.Subject)
	}
	return lines
}

func filePaths(files []gitclient.CommitFile) []string {
	names := make([]string, 0, len(files))
	for _, file := range files {
		names = append(names, file.Path)
	}
	return names
}

// fileIn finds one file of a commit by the name it has afterwards, so an assertion says which file it is
// about rather than which position it came in.
func fileIn(t *testing.T, detail gitclient.CommitDetail, path string) gitclient.CommitFile {
	t.Helper()

	for _, file := range detail.Files {
		if file.Path == path {
			return file
		}
	}
	require.FailNowf(t, "missing file", "%s is not among %v", path, filePaths(detail.Files))
	return gitclient.CommitFile{}
}

func branchNames(list []gitclient.Branch) []string {
	names := make([]string, 0, len(list))
	for _, branch := range list {
		names = append(names, branch.Name)
	}
	return names
}

// paths pulls the file names out of one of the status lists, which is what most assertions here are
// about; the letters are checked where they are the point.
func paths(changes []gitclient.FileChange) []string {
	names := make([]string, 0, len(changes))
	for _, change := range changes {
		names = append(names, change.Path)
	}
	return names
}

// requireGit skips a journey that cannot run without the git binary the write endpoints shell out to.
func requireGit(t *testing.T) {
	t.Helper()
	if !gitclient.Available() {
		t.Skip("no git binary is installed")
	}
}

/*
initRepo makes the project a repository with an identity, and answers with it.

The identity is set in the repository's own config rather than left to the machine's: the write
endpoints run the real git, which refuses to commit without a user.name and a user.email — and CI has
neither.
*/
func initRepo(t *testing.T, project string) *git.Repository {
	t.Helper()

	repo, err := git.PlainInit(project, false)
	require.NoError(t, err)

	config, err := repo.Config()
	require.NoError(t, err)
	config.User.Name = "Test"
	config.User.Email = "test@example.com"
	// Off, since a machine whose git config signs every commit has no key here to sign with.
	config.Raw.Section("commit").SetOption("gpgsign", "false")
	require.NoError(t, repo.SetConfig(config))

	return repo
}

func TestAProjectThatIsNotAGitRepositoryIsAStateAndNotAnError(t *testing.T) {
	srv, _ := testServer(t)

	// Not a repository is not a failure: a project directory is under no obligation to be under git,
	// and answering 500 put red errors in the console of every session opened on a plain folder.
	branch := getJSON[gitclient.BranchResponse](t, srv, "/api/current-branch")
	assert.False(t, branch.IsRepository)
	assert.Empty(t, branch.Branch)

	status := gitStatus(t, srv)
	assert.False(t, status.IsRepository)
	assert.Empty(t, status.Staged)
	assert.Empty(t, status.Unstaged)
	assert.Empty(t, status.Untracked)

	graph := history(t, srv, "")
	assert.False(t, graph.IsRepository)
	assert.Empty(t, graph.Commits)

	// And the writes refuse it rather than reporting a server fault, since there is no index to change.
	code, _ := call(t, srv, http.MethodPost, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})
	assert.Equal(t, http.StatusConflict, code)
}

func TestARepositoryWithNothingCommittedYetHasABranchAndNoHistory(t *testing.T) {
	srv, project := testServer(t)
	repo := initRepo(t, project)
	writeFile(t, project, "notes.txt", "hello")

	// There is no commit for HEAD to point at, so the branch has to come from HEAD itself. This is the
	// state a project is in between `git init` and the first commit, and it used to answer 500.
	branch := getJSON[gitclient.BranchResponse](t, srv, "/api/current-branch")
	assert.True(t, branch.IsRepository)
	head, err := repo.Reference("HEAD", false)
	require.NoError(t, err)
	assert.Equal(t, head.Target().Short(), branch.Branch)

	graph := history(t, srv, "")
	assert.True(t, graph.IsRepository)
	assert.Empty(t, graph.Commits, "a repository with no commits has an empty history")

	status := gitStatus(t, srv)
	assert.True(t, status.IsRepository)
	assert.Equal(t, []string{"notes.txt"}, paths(status.Untracked))
	assert.Empty(t, status.Staged)
	assert.Empty(t, status.Unstaged)
}

func TestARepositoryWithHistoryAnswersItsBranchCommitsAndChanges(t *testing.T) {
	srv, project := testServer(t)
	repo := initRepo(t, project)
	writeFile(t, project, "notes.txt", "hello")
	commitFile(t, repo, "notes.txt", "the first one")

	branch := getJSON[gitclient.BranchResponse](t, srv, "/api/current-branch")
	assert.True(t, branch.IsRepository)
	assert.NotEmpty(t, branch.Branch)

	graph := history(t, srv, "")
	assert.True(t, graph.IsRepository)
	require.Len(t, graph.Commits, 1)
	assert.Equal(t, "the first one", graph.Commits[0].Subject)
	assert.Empty(t, graph.Commits[0].Parents, "the first commit has no parent")

	// Committed, so nothing is outstanding.
	status := gitStatus(t, srv)
	assert.Empty(t, status.Unstaged)

	// And a change to a tracked file is, on the worktree side and not the staged one.
	writeFile(t, project, "notes.txt", "hello again")
	status = gitStatus(t, srv)
	require.Len(t, status.Unstaged, 1)
	assert.Equal(t, "notes.txt", status.Unstaged[0].Path)
	assert.Equal(t, "M", status.Unstaged[0].Worktree)
	assert.Empty(t, status.Unstaged[0].Staged)
	assert.Empty(t, status.Staged)
}

/*
Staging, committing, and what the commit contained.

This is the defect the whole endpoint was rewritten for: the old commit added the files it was given and
then committed with All, so every modified tracked file in the repository went in. Ticking one file of
two committed two, and the tick boxes were the only thing that suggested otherwise. Here one of two
files is staged, and the other one has to still be outstanding afterwards.
*/
func TestOnlyWhatIsStagedIsCommitted(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	repo := initRepo(t, project)
	writeFile(t, project, "notes.txt", "hello")
	writeFile(t, project, "other.txt", "hello")
	commitFile(t, repo, "notes.txt", "the first one")
	commitFile(t, repo, "other.txt", "the second one")

	writeFile(t, project, "notes.txt", "changed")
	writeFile(t, project, "other.txt", "changed too")

	status := post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})
	// A staged change is visible at all, which it was not: the old status only looked at the worktree
	// side, so staging a file made it disappear from the panel.
	require.Len(t, status.Staged, 1)
	assert.Equal(t, "notes.txt", status.Staged[0].Path)
	assert.Equal(t, "M", status.Staged[0].Staged)
	assert.Equal(t, []string{"other.txt"}, paths(status.Unstaged))

	status = post(t, srv, "/api/git/commit", map[string]any{"message": "just the one"})
	assert.Empty(t, status.Staged)
	assert.Equal(t, []string{"other.txt"}, paths(status.Unstaged), "the file that was not staged is still outstanding")

	graph := history(t, srv, "")
	require.Len(t, graph.Commits, 3)
	assert.Contains(t, graph.Commits[0].Subject, "just the one")

	// And the commit really contains one file, which is the part the status cannot show.
	changed := gitOutput(t, project, "show", "--name-only", "--format=", "HEAD")
	assert.Equal(t, "notes.txt", changed)
}

// A file staged and then changed again is in both lists at once, which is what git reports and what the
// single list of names could not express: what is about to be committed and what is not are different
// versions of the same file.
func TestAFileStagedAndThenChangedAgainIsInBothLists(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	repo := initRepo(t, project)
	writeFile(t, project, "notes.txt", "hello")
	commitFile(t, repo, "notes.txt", "the first one")

	writeFile(t, project, "notes.txt", "staged")
	post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})
	writeFile(t, project, "notes.txt", "and then changed again")

	status := gitStatus(t, srv)
	assert.Equal(t, []string{"notes.txt"}, paths(status.Staged))
	assert.Equal(t, []string{"notes.txt"}, paths(status.Unstaged))
	assert.Equal(t, "M", status.Staged[0].Staged)
	assert.Equal(t, "M", status.Unstaged[0].Worktree)
}

// Unstaging in a repository with no commits yet. `git restore --staged` and `git reset` both fail there
// with "Failed to resolve 'HEAD'", so this is the one case unstaging has to do something else — and it
// is the state every newly initialised project is in.
func TestAFileCanBeUnstagedBeforeThereIsAnyHistory(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	initRepo(t, project)
	writeFile(t, project, "notes.txt", "hello")

	status := post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})
	assert.Equal(t, []string{"notes.txt"}, paths(status.Staged))
	assert.Equal(t, "A", status.Staged[0].Staged)

	status = post(t, srv, "/api/git/unstage", map[string]any{"paths": []string{"notes.txt"}})
	assert.Empty(t, status.Staged)
	assert.Equal(t, []string{"notes.txt"}, paths(status.Untracked), "unstaged, and back to being untracked")

	// Unstaging is not a delete: the file it was about is still on disk.
	assert.FileExists(t, filepath.Join(project, "notes.txt"))
}

/*
Discarding puts a tracked file back and refuses to silently delete an untracked one.

Discarding an untracked file is a delete with no undo — there is no committed version to restore — so a
request that has not said it means to delete is refused rather than guessed at.
*/
func TestDiscardRestoresTrackedFilesAndRefusesToDeleteUntrackedOnesUnasked(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	repo := initRepo(t, project)
	writeFile(t, project, "notes.txt", "the committed text")
	commitFile(t, repo, "notes.txt", "the first one")
	writeFile(t, project, "notes.txt", "an edit to throw away")
	writeFile(t, project, "scratch.txt", "never committed")

	status := post(t, srv, "/api/git/discard", map[string]any{"paths": []string{"notes.txt"}})
	assert.Empty(t, status.Unstaged)
	contents, err := os.ReadFile(filepath.Join(project, "notes.txt"))
	require.NoError(t, err)
	assert.Equal(t, "the committed text", string(contents))

	code, body := call(t, srv, http.MethodPost, "/api/git/discard", map[string]any{
		"paths": []string{"scratch.txt"},
	})
	assert.Equal(t, http.StatusConflict, code)
	assert.Contains(t, string(body), "not tracked")
	assert.FileExists(t, filepath.Join(project, "scratch.txt"), "refused, so still there")

	// Asked for plainly, it goes.
	post(t, srv, "/api/git/discard", map[string]any{
		"paths": []string{"scratch.txt"}, "deleteUntracked": true,
	})
	assert.NoFileExists(t, filepath.Join(project, "scratch.txt"))
}

// A commit needs a message and something staged, and says which is missing. Left to git, the second one
// answers "nothing added to commit but untracked files present", which does not tell someone looking at
// a panel full of changes what to do about it.
func TestACommitIsRefusedWithoutAMessageOrAnythingStaged(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	initRepo(t, project)
	writeFile(t, project, "notes.txt", "hello")

	code, body := call(t, srv, http.MethodPost, "/api/git/commit", map[string]any{"message": ""})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, string(body), "message")

	code, body = call(t, srv, http.MethodPost, "/api/git/commit", map[string]any{"message": "nothing to say"})
	assert.Equal(t, http.StatusConflict, code)
	assert.Contains(t, string(body), "Nothing is staged")
}

// Paths in a request are confined to the repository, the way content requests are. Without it, staging
// is an arbitrary-path read: `git add ../../secret` copies a file from outside the project into an
// object nobody meant to commit.
func TestAPathOutsideTheRepositoryIsRefused(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	initRepo(t, project)
	writeFile(t, filepath.Dir(project), "outside.txt", "not yours")

	for _, path := range []string{"../outside.txt", "notes/../../outside.txt", "/etc/hosts"} {
		t.Run(path, func(t *testing.T) {
			code, body := call(t, srv, http.MethodPost, "/api/git/stage", map[string]any{
				"paths": []string{path},
			})
			assert.Equal(t, http.StatusBadRequest, code, "body was %s", body)
			assert.Contains(t, string(body), "outside the repository")
		})
	}
}

// Zasper opened on a subdirectory of a checkout is opened on a repository. Without DetectDotGit the
// panel said the project was not under git, which is most of what a monorepo user would ever see.
func TestAProjectInsideARepositoryIsStillARepository(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)

	// The repository is the directory above the project the server is serving.
	checkout := filepath.Dir(project)
	repo := initRepo(t, checkout)
	writeFile(t, project, "notes.txt", "hello")

	status := gitStatus(t, srv)
	assert.True(t, status.IsRepository)
	assert.NotEmpty(t, status.Branch)

	// The path is the one git uses, which is relative to the repository root rather than the project.
	assert.Equal(t, []string{"project/notes.txt"}, paths(status.Untracked))

	post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"project/notes.txt"}})
	status = post(t, srv, "/api/git/commit", map[string]any{"message": "from a subdirectory"})
	assert.Empty(t, status.Staged)

	head, err := repo.Head()
	require.NoError(t, err)
	commit, err := repo.CommitObject(head.Hash())
	require.NoError(t, err)
	assert.Equal(t, "from a subdirectory\n", commit.Message)
}

/*
Committing and pushing in one request, against a real remote.

The remote is a bare repository in a temp directory, so this tests the push path — including that it
sets an upstream for a branch that has none — with no network and no credentials. The previous
implementation called go-git's Push with an empty PushOptions, which cannot authenticate against
anything and had no test to say so.
*/
func TestACommitCanBePushedToItsRemote(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	initRepo(t, project)

	remotePath := filepath.Join(t.TempDir(), "origin.git")
	_, err := git.PlainInit(remotePath, true)
	require.NoError(t, err)
	gitOutput(t, project, "remote", "add", "origin", remotePath)

	writeFile(t, project, "notes.txt", "hello")
	post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})
	status := post(t, srv, "/api/git/commit", map[string]any{
		"message": "the first one", "push": true,
	})
	assert.True(t, status.HasRemote)
	// Pushed, so the branch is level with an upstream it did not have before.
	assert.NotEmpty(t, status.Upstream)
	assert.Zero(t, status.Ahead)
	assert.Zero(t, status.Behind)

	// And the remote has it.
	remote, err := git.PlainOpen(remotePath)
	require.NoError(t, err)
	head, err := remote.Head()
	require.NoError(t, err)
	commit, err := remote.CommitObject(head.Hash())
	require.NoError(t, err)
	assert.Equal(t, "the first one\n", commit.Message)

	// A second commit that is not pushed is reported as ahead, which is what the panel's sync count is.
	writeFile(t, project, "notes.txt", "hello again")
	post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})
	status = post(t, srv, "/api/git/commit", map[string]any{"message": "the second one"})
	assert.Equal(t, 1, status.Ahead)
	assert.Zero(t, status.Behind)
}

// A push that cannot work is reported as such, and says the commit was made anyway — told only that it
// failed, the user commits again and gets an empty commit or an amend they did not mean.
func TestAFailedPushStillSaysTheCommitWasMade(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	initRepo(t, project)
	gitOutput(t, project, "remote", "add", "origin", filepath.Join(t.TempDir(), "nothing-here.git"))

	writeFile(t, project, "notes.txt", "hello")
	post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})

	code, body := call(t, srv, http.MethodPost, "/api/git/commit", map[string]any{
		"message": "the first one", "push": true,
	})
	assert.Equal(t, http.StatusConflict, code)
	assert.Contains(t, string(body), "commit was made")

	// It was: the history has it, whatever happened to the push.
	graph := history(t, srv, "")
	require.Len(t, graph.Commits, 1)
}

/*
Branches, all the way round: listed, made, switched to, and deleted.

Every one of those is new — the panel could read the current branch and nothing else — and they are one
journey because that is the order they happen in: a branch that cannot be switched to is not worth
creating, and one that cannot be deleted accumulates.
*/
func TestABranchCanBeListedCreatedSwitchedToAndDeleted(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	repo := initRepo(t, project)
	writeFile(t, project, "notes.txt", "hello")
	commitFile(t, repo, "notes.txt", "the first one")

	// Whatever init.defaultBranch calls it on this machine.
	main := gitStatus(t, srv).Branch

	list := branches(t, srv)
	require.Len(t, list, 1)
	assert.Equal(t, main, list[0].Name)
	assert.True(t, list[0].Current)
	assert.False(t, list[0].IsRemote)
	assert.Empty(t, list[0].Upstream, "nothing has been pushed, so it tracks nothing")

	status := post(t, srv, "/api/git/checkout", map[string]any{"branch": "topic", "create": true})
	assert.Equal(t, "topic", status.Branch, "created and switched to in one step")
	assert.Equal(t, []string{main, "topic"}, branchNames(branches(t, srv)))

	// Deleting the branch that is checked out is git's refusal to make, and its words are what the panel
	// shows: this package does not repeat the check. Which words those are is git's to change — it has
	// said both "checked out at" and "used by worktree at" — so what is asserted is that it refused, said
	// which branch, and left it alone.
	code, body := call(t, srv, http.MethodDelete, "/api/git/branches", map[string]any{"name": "topic"})
	assert.Equal(t, http.StatusConflict, code)
	assert.Contains(t, string(body), "topic")
	assert.Equal(t, []string{main, "topic"}, branchNames(branches(t, srv)))

	status = post(t, srv, "/api/git/checkout", map[string]any{"branch": main})
	assert.Equal(t, main, status.Branch)

	del(t, srv, "/api/git/branches", map[string]any{"name": "topic"})
	assert.Equal(t, []string{main}, branchNames(branches(t, srv)))
}

/*
A checkout that would overwrite uncommitted work is refused, and says which file is in the way.

Left to git deliberately. The alternative — asking first — means either duplicating git's check or
offering to throw away changes, and a source control panel that loses an edit on a branch switch is worse
than one that cannot switch.
*/
func TestACheckoutThatWouldLoseWorkIsRefused(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	repo := initRepo(t, project)
	writeFile(t, project, "notes.txt", "hello")
	commitFile(t, repo, "notes.txt", "the first one")
	main := gitStatus(t, srv).Branch

	post(t, srv, "/api/git/checkout", map[string]any{"branch": "topic", "create": true})
	writeFile(t, project, "notes.txt", "the topic version")
	post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})
	post(t, srv, "/api/git/commit", map[string]any{"message": "on topic"})
	post(t, srv, "/api/git/checkout", map[string]any{"branch": main})

	writeFile(t, project, "notes.txt", "an edit nobody has committed")
	code, body := call(t, srv, http.MethodPost, "/api/git/checkout", map[string]any{"branch": "topic"})
	assert.Equal(t, http.StatusConflict, code)
	assert.Contains(t, string(body), "notes.txt")

	// Refused, so nothing moved and nothing was lost.
	status := gitStatus(t, srv)
	assert.Equal(t, main, status.Branch)
	contents, err := os.ReadFile(filepath.Join(project, "notes.txt"))
	require.NoError(t, err)
	assert.Equal(t, "an edit nobody has committed", string(contents))
}

/*
A branch name git would read as an option is refused before it reaches a command line.

check-ref-format allows a leading dash, so `git checkout -b -f` is a valid request to make a branch and an
invalid command to run. The rest of the names here git would refuse itself; they are checked in the same
place so the panel's answer to all of them is the same.
*/
func TestABranchNameGitWouldReadAsAnOptionIsRefused(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	repo := initRepo(t, project)
	writeFile(t, project, "notes.txt", "hello")
	commitFile(t, repo, "notes.txt", "the first one")

	for _, name := range []string{"-f", "--force", "bad..name", "with space", "ends.with.a.dot.", ""} {
		t.Run(name, func(t *testing.T) {
			code, body := call(t, srv, http.MethodPost, "/api/git/checkout", map[string]any{
				"branch": name, "create": true,
			})
			assert.Equal(t, http.StatusConflict, code, "body was %s", body)
		})
	}

	// And a start point cannot be an option either, whatever the branch is called.
	code, _ := call(t, srv, http.MethodPost, "/api/git/checkout", map[string]any{
		"branch": "topic", "create": true, "from": "--orphan",
	})
	assert.Equal(t, http.StatusConflict, code)

	assert.Len(t, branches(t, srv), 1, "nothing was created")
}

/*
A branch that exists only on the remote is checked out as a local branch that follows it.

A fresh clone has one local branch, and every branch a colleague made is a remote-tracking ref. Checking
one out with plain `git checkout origin/topic` leaves a detached HEAD — a state this panel has nothing to
say about and most people have to look up how to leave.
*/
func TestARemoteBranchIsCheckedOutAsALocalBranchThatFollowsIt(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	initRepo(t, project)

	remotePath := filepath.Join(t.TempDir(), "origin.git")
	_, err := git.PlainInit(remotePath, true)
	require.NoError(t, err)
	gitOutput(t, project, "remote", "add", "origin", remotePath)

	writeFile(t, project, "notes.txt", "hello")
	post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})
	post(t, srv, "/api/git/commit", map[string]any{"message": "the first one", "push": true})

	// A branch on the remote that was never a branch here, which is what somebody else's work looks like
	// after a fetch.
	gitOutput(t, project, "push", "origin", "HEAD:refs/heads/theirs")
	gitOutput(t, project, "fetch", "origin")

	list := branches(t, srv)
	assert.Contains(t, branchNames(list), "origin/theirs")
	for _, branch := range list {
		if branch.Name == "origin/theirs" {
			assert.True(t, branch.IsRemote)
			assert.False(t, branch.Current)
		}
	}
	// origin/HEAD is a symbolic ref naming the remote's default branch, not a branch to offer.
	assert.NotContains(t, branchNames(list), "origin/HEAD")

	status := post(t, srv, "/api/git/checkout", map[string]any{"branch": "origin/theirs"})
	assert.Equal(t, "theirs", status.Branch)
	assert.Equal(t, "origin/theirs", status.Upstream, "and it tracks what it came from")
}

/*
Fetch reports what is on the remote without touching the worktree, and pull takes it.

The two are separate buttons for the reason this asserts: a fetch is safe — it answers "what is there?"
and changes no file anyone is editing — where a pull writes the worktree and can stop halfway with
conflicts.
*/
func TestFetchReportsWhatIsBehindAndPullTakesIt(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	initRepo(t, project)

	remotePath := filepath.Join(t.TempDir(), "origin.git")
	_, err := git.PlainInit(remotePath, true)
	require.NoError(t, err)
	gitOutput(t, project, "remote", "add", "origin", remotePath)

	writeFile(t, project, "notes.txt", "hello")
	post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})
	post(t, srv, "/api/git/commit", map[string]any{"message": "the first one", "push": true})

	// Somebody else's commit, made in a clone and pushed: the thing there is to fetch.
	elsewhere := filepath.Join(t.TempDir(), "clone")
	gitOutput(t, project, "clone", remotePath, elsewhere)
	writeFile(t, elsewhere, "theirs.txt", "from somebody else")
	gitOutput(t, elsewhere, "add", "theirs.txt")
	gitOutput(t, elsewhere, "-c", "user.name=Other", "-c", "user.email=other@example.com",
		"-c", "commit.gpgsign=false", "commit", "-m", "theirs")
	gitOutput(t, elsewhere, "push")

	// Nothing has been fetched, so there is nothing the panel could know about it.
	assert.Zero(t, gitStatus(t, srv).Behind)

	status := post(t, srv, "/api/git/fetch", nil)
	assert.Equal(t, 1, status.Behind)
	assert.Zero(t, status.Ahead)
	assert.NoFileExists(t, filepath.Join(project, "theirs.txt"), "a fetch writes no file in the worktree")

	status = post(t, srv, "/api/git/pull", nil)
	assert.Zero(t, status.Behind)
	assert.FileExists(t, filepath.Join(project, "theirs.txt"))
}

// Pushing what has already been committed, which is the button beside the counts rather than the checkbox
// on the commit.
func TestPushSendsCommitsThatWereMadeWithoutIt(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	initRepo(t, project)

	remotePath := filepath.Join(t.TempDir(), "origin.git")
	_, err := git.PlainInit(remotePath, true)
	require.NoError(t, err)
	gitOutput(t, project, "remote", "add", "origin", remotePath)

	writeFile(t, project, "notes.txt", "hello")
	post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})
	status := post(t, srv, "/api/git/commit", map[string]any{"message": "the first one"})
	assert.Empty(t, status.Upstream, "committed without pushing, so there is nowhere it is following yet")

	// The first push has to set an upstream, since nothing has given the branch one.
	status = post(t, srv, "/api/git/push", nil)
	assert.NotEmpty(t, status.Upstream)
	assert.Zero(t, status.Ahead)

	remote, err := git.PlainOpen(remotePath)
	require.NoError(t, err)
	head, err := remote.Head()
	require.NoError(t, err)
	commit, err := remote.CommitObject(head.Hash())
	require.NoError(t, err)
	assert.Equal(t, "the first one\n", commit.Message)
}

// A project with no remote has nothing to sync with, and says so rather than running a git command whose
// failure would need explaining.
func TestSyncingIsRefusedWithoutARemote(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	repo := initRepo(t, project)
	writeFile(t, project, "notes.txt", "hello")
	commitFile(t, repo, "notes.txt", "the first one")

	for _, path := range []string{"/api/git/fetch", "/api/git/pull", "/api/git/push"} {
		t.Run(path, func(t *testing.T) {
			code, body := call(t, srv, http.MethodPost, path, nil)
			assert.Equal(t, http.StatusConflict, code)
			assert.Contains(t, string(body), "no remote")
		})
	}
}

/*
The history a page at a time.

The old endpoint walked to the root commit on every read — on boot, on every commit, and on every
filesystem event the panel noticed — and sent all of it to a list that draws a screenful. The paging is
what this asserts; the order is asserted with it, because a page of the wrong end of the history would
satisfy every count here.
*/
func TestTheHistoryIsPagedNewestFirstAndSaysWhenThereIsMore(t *testing.T) {
	srv, project := testServer(t)
	repo := initRepo(t, project)

	for _, message := range []string{"one", "two", "three", "four", "five"} {
		writeFile(t, project, "notes.txt", message)
		commitFile(t, repo, "notes.txt", message)
	}

	first := history(t, srv, "?limit=2")
	require.Len(t, first.Commits, 2)
	assert.True(t, first.HasMore)
	assert.Equal(t, []string{"five", "four"}, subjects(first.Commits), "newest first, as git logs it")

	second := history(t, srv, "?limit=2&skip=2")
	assert.Equal(t, []string{"three", "two"}, subjects(second.Commits))
	assert.True(t, second.HasMore)

	// The last page says so, which is what takes the "Show more" button away.
	last := history(t, srv, "?limit=2&skip=4")
	assert.Equal(t, []string{"one"}, subjects(last.Commits))
	assert.False(t, last.HasMore)

	// Past the end is empty rather than an error: a panel asking for another page of a history that has
	// been rewritten under it is not a fault.
	assert.Empty(t, history(t, srv, "?skip=99").Commits)

	// A page size that will not parse is the default rather than a 400, since a bad query string is not
	// worth failing a read over.
	whole := history(t, srv, "?limit=nonsense")
	assert.Len(t, whole.Commits, 5)
	assert.False(t, whole.HasMore)
}

/*
What one commit changed, which is what a row of the history expands into.

Every letter git can report about a file in a commit, in one commit: something added, something modified,
something deleted, and something renamed. The counts are the other half — a row saying only that a file
changed is the history the panel already had.
*/
func TestACommitSaysWhichFilesItChangedAndByHowMuch(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	repo := initRepo(t, project)

	writeFile(t, project, "notes.txt", "one\ntwo\nthree\n")
	writeFile(t, project, "old-name.txt", "moved unchanged\n")
	writeFile(t, project, "doomed.txt", "not for long\n")
	commitFile(t, repo, ".", "the first one")

	// The root commit, which has no parent to be diffed against: every file in it is an addition, which
	// is what git says about one too.
	head := gitOutput(t, project, "rev-parse", "HEAD")
	root := commitDetail(t, srv, head)
	assert.Equal(t, "the first one", root.Subject)
	assert.Equal(t, head[:7], root.ShortHash)
	assert.Equal(t, []string{"doomed.txt", "notes.txt", "old-name.txt"}, filePaths(root.Files))
	assert.Equal(t, "A", fileIn(t, root, "notes.txt").Status)
	assert.Equal(t, 3, fileIn(t, root, "notes.txt").Insertions)
	assert.Zero(t, fileIn(t, root, "notes.txt").Deletions)
	assert.Equal(t, 5, root.Insertions, "three lines and one each in the other two")

	_, err := time.Parse(time.RFC3339, root.Date)
	assert.NoError(t, err, "the date has to be one a browser can parse; %q is not", root.Date)

	// Now one of each.
	writeFile(t, project, "notes.txt", "one\ntwo changed\nthree\nfour\n")
	writeFile(t, project, "fresh.txt", "new\n")
	gitOutput(t, project, "rm", "-q", "doomed.txt")
	gitOutput(t, project, "mv", "old-name.txt", "new-name.txt")
	post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"."}})
	post(t, srv, "/api/git/commit", map[string]any{"message": "one of each"})

	detail := commitDetail(t, srv, gitOutput(t, project, "rev-parse", "HEAD"))
	assert.Equal(t, "one of each", detail.Subject)
	assert.Equal(t, "A", fileIn(t, detail, "fresh.txt").Status)
	assert.Equal(t, "D", fileIn(t, detail, "doomed.txt").Status)
	assert.Equal(t, 1, fileIn(t, detail, "doomed.txt").Deletions)

	modified := fileIn(t, detail, "notes.txt")
	assert.Equal(t, "M", modified.Status)
	assert.Equal(t, 2, modified.Insertions, "one line changed and one added")
	assert.Equal(t, 1, modified.Deletions)

	// A rename is one file with two names, not a delete and an add: told those, the panel would say a
	// commit that moved a notebook deleted it.
	renamed := fileIn(t, detail, "new-name.txt")
	assert.Equal(t, "R", renamed.Status)
	assert.Equal(t, "old-name.txt", renamed.From)
	assert.Zero(t, renamed.Insertions, "the contents did not change")

	assert.NotEmpty(t, detail.Parents, "everything after the first commit has a parent")
	assert.False(t, detail.Truncated)
}

// A commit that is not there is the caller's mistake, not the server's: a panel left open across a rebase
// asks about commits that no longer exist.
func TestACommitThatIsNotThereIsNotFound(t *testing.T) {
	srv, project := testServer(t)

	// Before there is a repository at all, which is the same answer: there is no such commit here.
	code, _ := call(t, srv, http.MethodGet, "/api/git/commit/HEAD", nil)
	assert.Equal(t, http.StatusNotFound, code)

	repo := initRepo(t, project)
	writeFile(t, project, "notes.txt", "hello")
	commitFile(t, repo, "notes.txt", "the first one")

	code, body := call(t, srv, http.MethodGet, "/api/git/commit/0000000000000000000000000000000000000000", nil)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Contains(t, string(body), "not a commit")
}

/*
A plain folder becomes a repository.

The panel had nothing to offer someone who opened Zasper on a directory that was not under git, which is
every new project: it said "This project is not a git repository." and stopped there.
*/
func TestAPlainFolderCanBeMadeIntoARepository(t *testing.T) {
	srv, project := testServer(t)
	requireGit(t)
	writeFile(t, project, "notes.txt", "hello")

	assert.False(t, gitStatus(t, srv).IsRepository)

	status := post(t, srv, "/api/git/init", nil)
	assert.True(t, status.IsRepository)
	assert.NotEmpty(t, status.Branch, "a repository with no commits still has the branch the first one will land on")
	assert.Equal(t, []string{"notes.txt"}, paths(status.Untracked), "what was already in the folder is untracked")
	assert.Empty(t, history(t, srv, "").Commits)

	// Usable, not merely present: staging is the next thing the panel offers.
	status = post(t, srv, "/api/git/stage", map[string]any{"paths": []string{"notes.txt"}})
	assert.Equal(t, []string{"notes.txt"}, paths(status.Staged))

	// And a second one is refused rather than nesting a repository inside a repository, which is a
	// situation nobody recovers from by clicking.
	code, body := call(t, srv, http.MethodPost, "/api/git/init", nil)
	assert.Equal(t, http.StatusConflict, code)
	assert.Contains(t, string(body), "already")
}

func writeFile(t *testing.T, dir, name, contents string) {
	t.Helper()
	require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(contents), 0o644))
}

// gitOutput runs git in a directory for the setup steps and the assertions that are about what git
// itself thinks, and answers with its output.
func gitOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "git %v said: %s", args, out)
	return strings.TrimSpace(string(out))
}

// commitFile records one file. The signature is given rather than left to go-git, which would otherwise
// read the machine's git config and find nothing in CI.
func commitFile(t *testing.T, repo *git.Repository, path, message string) {
	t.Helper()

	tree, err := repo.Worktree()
	require.NoError(t, err)
	_, err = tree.Add(path)
	require.NoError(t, err)
	_, err = tree.Commit(message, &git.CommitOptions{
		Author: &object.Signature{Name: "Test", Email: "test@example.com", When: time.Now()},
	})
	require.NoError(t, err)
}
