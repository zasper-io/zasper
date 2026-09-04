/*
The parts of the status model no HTTP journey can reach: what a repository in the middle of a merge looks
like, and where a path is allowed to point.

The journeys in internal/server cover staging, committing and discarding through the router. These two
are here because one needs a repository put into a state the endpoints cannot put it into, and the other
is about paths that never reach a git command at all.
*/
package gitclient

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/go-git/go-git/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/core"
)

// gitIn runs git in a directory, for the setup a test needs and the endpoints do not offer.
func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "git %v said: %s", args, out)
	return string(out)
}

// projectRepo makes a repository with an identity and points core.Zasper at it, since that is where
// openRepo looks. Only HomeDir is set: the rest of the application config has nothing to do with git,
// and building it runs subprocesses this test does not need.
func projectRepo(t *testing.T) string {
	t.Helper()

	if !Available() {
		t.Skip("no git binary is installed")
	}

	dir := t.TempDir()
	_, err := git.PlainInit(dir, false)
	require.NoError(t, err)
	gitIn(t, dir, "config", "user.name", "Test")
	gitIn(t, dir, "config", "user.email", "test@example.com")
	gitIn(t, dir, "config", "commit.gpgsign", "false")

	restore := core.Zasper.HomeDir
	core.Zasper.HomeDir = dir
	t.Cleanup(func() { core.Zasper.HomeDir = restore })

	return dir
}

/*
A repository in the middle of a merge reports its conflicted files as conflicted.

Worth its own test because it does not come from the status at all: go-git computes one by diffing HEAD
against the index against the worktree, and a conflicted path comes out of that looking like an ordinary
modification — its StatusCode for this, UpdatedButUnmerged, is declared and never assigned. What marks a
conflict is the index holding the path more than once, at stage 2 and stage 3, which is what
conflictedPaths reads.
*/
func TestAConflictedFileIsReportedAsConflicted(t *testing.T) {
	dir := projectRepo(t)

	require.NoError(t, os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("first\n"), 0o644))
	gitIn(t, dir, "add", "notes.txt")
	gitIn(t, dir, "commit", "-m", "the first one")

	main := gitIn(t, dir, "rev-parse", "--abbrev-ref", "HEAD")
	main = main[:len(main)-1]

	gitIn(t, dir, "checkout", "-b", "other")
	require.NoError(t, os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("theirs\n"), 0o644))
	gitIn(t, dir, "commit", "-am", "theirs")

	gitIn(t, dir, "checkout", main)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("ours\n"), 0o644))
	gitIn(t, dir, "commit", "-am", "ours")

	// Expected to fail: that is the conflict. Run directly rather than through gitIn, which requires
	// success.
	merge := exec.Command("git", "merge", "other")
	merge.Dir = dir
	out, err := merge.CombinedOutput()
	require.Error(t, err, "the merge should have conflicted: %s", out)

	repo, root, err := openRepo()
	require.NoError(t, err)
	assert.Equal(t, dirResolved(t, dir), dirResolved(t, root))

	status, err := getStatus(repo)
	require.NoError(t, err)

	require.Len(t, status.Conflicted, 1, "status was %+v", status)
	assert.Equal(t, "notes.txt", status.Conflicted[0].Path)
	assert.Equal(t, "U", status.Conflicted[0].Staged)
	assert.Equal(t, "U", status.Conflicted[0].Worktree)

	// And it is only in that list: offered as an ordinary change, it would be staged and committed with
	// the conflict markers still in it.
	assert.Empty(t, status.Staged)
	assert.Empty(t, status.Unstaged)
}

/*
A file taken out of the index but left on disk is both a staged deletion and an untracked file.

This is what `git rm --cached` leaves behind, and git's own short status prints it as two lines — D and
??. Grouping it by its worktree side alone hid the deletion, so a panel showing only "untracked" would
have carried a delete into the next commit with nothing on screen saying so.
*/
func TestAFileRemovedFromTheIndexButNotFromDiskIsInBothLists(t *testing.T) {
	dir := projectRepo(t)

	require.NoError(t, os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("first\n"), 0o644))
	gitIn(t, dir, "add", "notes.txt")
	gitIn(t, dir, "commit", "-m", "the first one")
	gitIn(t, dir, "rm", "--cached", "--quiet", "notes.txt")

	repo, _, err := openRepo()
	require.NoError(t, err)

	status, err := getStatus(repo)
	require.NoError(t, err)

	require.Len(t, status.Staged, 1, "status was %+v", status)
	assert.Equal(t, "notes.txt", status.Staged[0].Path)
	assert.Equal(t, "D", status.Staged[0].Staged)

	require.Len(t, status.Untracked, 1)
	assert.Equal(t, "notes.txt", status.Untracked[0].Path)
	// Nothing is staged about the untracked entry itself; the deletion above is the staged half.
	assert.Equal(t, "", status.Untracked[0].Staged)
}

/*
A `git mv` is one renamed file, not a deletion and an unrelated addition.

go-git has no rename detection at all: it diffs HEAD's tree against the index path by path, so the move
arrives as a D and an A holding the same blob, and the panel would show a file the user still has as
deleted. Only exact renames are collapsed, which is every `git mv` and every rename made in the file
browser.
*/
func TestAMovedFileIsOneStagedRename(t *testing.T) {
	dir := projectRepo(t)

	require.NoError(t, os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("first\n"), 0o644))
	require.NoError(t, os.Mkdir(filepath.Join(dir, "src"), 0o755))
	gitIn(t, dir, "add", "notes.txt")
	gitIn(t, dir, "commit", "-m", "the first one")
	gitIn(t, dir, "mv", "notes.txt", filepath.Join("src", "renamed.txt"))

	repo, _, err := openRepo()
	require.NoError(t, err)

	status, err := getStatus(repo)
	require.NoError(t, err)

	require.Len(t, status.Staged, 1, "status was %+v", status)
	assert.Equal(t, "src/renamed.txt", status.Staged[0].Path)
	assert.Equal(t, "R", status.Staged[0].Staged)
	// Where it came from, which is the whole reason the row is worth collapsing: without it the panel
	// says a file appeared and gives no clue that another one left.
	assert.Equal(t, "notes.txt", status.Staged[0].From)

	assert.Empty(t, status.Unstaged)
	assert.Empty(t, status.Untracked)
}

/*
A file taken out of the index is not a rename source for a new file that happens to match it.

`git rm --cached` leaves the file where it was, so nothing moved: pairing it with an addition of the same
content would report a rename of a file that is still on disk, and hide the staged deletion that is
really there.
*/
func TestAFileStillOnDiskIsNotTreatedAsRenamedAway(t *testing.T) {
	dir := projectRepo(t)

	require.NoError(t, os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("first\n"), 0o644))
	gitIn(t, dir, "add", "notes.txt")
	gitIn(t, dir, "commit", "-m", "the first one")

	gitIn(t, dir, "rm", "--cached", "--quiet", "notes.txt")
	require.NoError(t, os.WriteFile(filepath.Join(dir, "copy.txt"), []byte("first\n"), 0o644))
	gitIn(t, dir, "add", "copy.txt")

	repo, _, err := openRepo()
	require.NoError(t, err)

	status, err := getStatus(repo)
	require.NoError(t, err)

	require.Len(t, status.Staged, 2, "status was %+v", status)
	assert.Equal(t, FileChange{Path: "copy.txt", Staged: "A", Worktree: ""}, status.Staged[0])
	assert.Equal(t, FileChange{Path: "notes.txt", Staged: "D", Worktree: "?"}, status.Staged[1])
}

/*
A repository with nothing to report answers with empty lists rather than nulls.

Not pedantry about JSON: the panel counts all four lists on every render, so a null is a crash on the
ordinary case of a clean checkout.
*/
func TestACleanRepositoryAnswersWithEmptyListsAndNotNulls(t *testing.T) {
	dir := projectRepo(t)

	require.NoError(t, os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("first\n"), 0o644))
	gitIn(t, dir, "add", "notes.txt")
	gitIn(t, dir, "commit", "-m", "the first one")

	repo, _, err := openRepo()
	require.NoError(t, err)

	status, err := getStatus(repo)
	require.NoError(t, err)

	encoded, err := json.Marshal(status)
	require.NoError(t, err)
	for _, list := range []string{"staged", "unstaged", "untracked", "conflicted"} {
		assert.Contains(t, string(encoded), `"`+list+`":[]`)
	}
}

func dirResolved(t *testing.T, path string) string {
	t.Helper()

	resolved, err := filepath.EvalSymlinks(path)
	require.NoError(t, err)
	return resolved
}

/*
Where a path from a request is allowed to point.

Every git command in this package is given paths a browser sent, so this is the boundary: without it,
staging is a way to copy a file from anywhere on disk into a commit, and discarding is a way to delete
one. The symlink case is the reason resolution happens before the comparison — a link inside the
repository pointing out of it is a path that passes a textual test and fails this one.
*/
func TestAPathIsConfinedToTheRepository(t *testing.T) {
	dir := projectRepo(t)
	root := dirResolved(t, dir)

	outside := filepath.Join(t.TempDir(), "secret.txt")
	require.NoError(t, os.WriteFile(outside, []byte("not yours"), 0o644))
	require.NoError(t, os.Symlink(outside, filepath.Join(dir, "link.txt")))

	t.Run("inside", func(t *testing.T) {
		for given, expected := range map[string]string{
			"notes.txt":                      "notes.txt",
			"./notes.txt":                    "notes.txt",
			"work/notes.txt":                 "work/notes.txt",
			"work/../notes.txt":              "notes.txt",
			filepath.Join(root, "notes.txt"): "notes.txt",
		} {
			got, err := relPath(root, given)
			require.NoError(t, err, "%s should have been allowed", given)
			assert.Equal(t, expected, got)
		}
	})

	t.Run("outside", func(t *testing.T) {
		for _, given := range []string{
			"../secret.txt",
			"work/../../secret.txt",
			outside,
			"link.txt",
			"",
		} {
			_, err := relPath(root, given)
			assert.Error(t, err, "%s should have been refused", given)
		}
	})

	// A deleted file has no path left to resolve, and discarding one is exactly what a panel is for.
	got, err := relPath(root, "gone.txt")
	require.NoError(t, err)
	assert.Equal(t, "gone.txt", got)
}
