/*
The git endpoints, over a project directory in each of the three states one can be in: not a repository
at all, a repository with nothing committed yet, and a repository with history.

The first of those is what most of this is about. The Git panel asks for the branch, the uncommitted
files and the commit graph on boot, so whatever those answer for a plain folder is what every session
opened on one sees.
*/
package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/gitclient"
)

// getJSON reads one of the git endpoints, requiring the 200 that all three of them owe a caller.
func getJSON[T any](t *testing.T, srv *httptest.Server, path string) T {
	t.Helper()

	status, body := call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status, "%s answered %d: %s", path, status, body)
	return decode[T](t, body)
}

func TestAProjectThatIsNotAGitRepositoryIsAStateAndNotAnError(t *testing.T) {
	srv, _ := testServer(t)

	// Not a repository is not a failure: a project directory is under no obligation to be under git,
	// and answering 500 put three red errors in the console of every session opened on a plain folder.
	branch := getJSON[gitclient.BranchResponse](t, srv, "/api/current-branch")
	assert.False(t, branch.IsRepository)
	assert.Empty(t, branch.Branch)

	files := getJSON[gitclient.UncommittedFilesResponse](t, srv, "/api/uncommitted-files")
	assert.False(t, files.IsRepository)
	assert.Empty(t, files.Files)

	graph := getJSON[gitclient.CommitGraphResponse](t, srv, "/api/commit-graph")
	assert.False(t, graph.IsRepository)
	assert.Empty(t, graph.Commits)
}

func TestARepositoryWithNothingCommittedYetHasABranchAndNoHistory(t *testing.T) {
	srv, project := testServer(t)
	repo, err := git.PlainInit(project, false)
	require.NoError(t, err)
	writeFile(t, project, "notes.txt", "hello")

	// There is no commit for HEAD to point at, so the branch has to come from HEAD itself. This is the
	// state a project is in between `git init` and the first commit, and it used to answer 500.
	branch := getJSON[gitclient.BranchResponse](t, srv, "/api/current-branch")
	assert.True(t, branch.IsRepository)
	head, err := repo.Reference("HEAD", false)
	require.NoError(t, err)
	assert.Equal(t, head.Target().Short(), branch.Branch)

	graph := getJSON[gitclient.CommitGraphResponse](t, srv, "/api/commit-graph")
	assert.True(t, graph.IsRepository)
	assert.Empty(t, graph.Commits, "a repository with no commits has an empty history")

	files := getJSON[gitclient.UncommittedFilesResponse](t, srv, "/api/uncommitted-files")
	assert.True(t, files.IsRepository)
	assert.Equal(t, []string{"notes.txt"}, files.Files)
}

func TestARepositoryWithHistoryAnswersItsBranchCommitsAndChanges(t *testing.T) {
	srv, project := testServer(t)
	repo, err := git.PlainInit(project, false)
	require.NoError(t, err)
	writeFile(t, project, "notes.txt", "hello")
	commitFile(t, repo, "notes.txt", "the first one")

	branch := getJSON[gitclient.BranchResponse](t, srv, "/api/current-branch")
	assert.True(t, branch.IsRepository)
	assert.NotEmpty(t, branch.Branch)

	graph := getJSON[gitclient.CommitGraphResponse](t, srv, "/api/commit-graph")
	assert.True(t, graph.IsRepository)
	require.Len(t, graph.Commits, 1)
	assert.Equal(t, "the first one", graph.Commits[0].Message)
	assert.Empty(t, graph.Commits[0].Parents, "the first commit has no parent")

	// Committed, so nothing is outstanding.
	files := getJSON[gitclient.UncommittedFilesResponse](t, srv, "/api/uncommitted-files")
	assert.Empty(t, files.Files)

	// And a change to a tracked file is.
	writeFile(t, project, "notes.txt", "hello again")
	files = getJSON[gitclient.UncommittedFilesResponse](t, srv, "/api/uncommitted-files")
	assert.Equal(t, []string{"notes.txt"}, files.Files)
}

func writeFile(t *testing.T, dir, name, contents string) {
	t.Helper()
	require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(contents), 0o644))
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
