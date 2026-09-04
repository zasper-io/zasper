/*
What the two sides of a comparison are, in each of the states a file can be in.

Unit tests rather than journeys because most of what can go wrong here is a question of which two
versions of a file were read: the index against the worktree and HEAD against the index are the same
endpoint with one flag between them, and getting that backwards produces a diff that looks perfectly
plausible and is about the wrong pair of documents.
*/
package gitclient

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A notebook with one output and an execution count, which is what the raw file comparison this avoids
// would be mostly made of.
const aNotebook = `{
 "cells": [
  {
   "cell_type": "code",
   "execution_count": 3,
   "id": "aaaa1111",
   "metadata": {},
   "outputs": [{"output_type": "stream", "name": "stdout", "text": ["1\n"]}],
   "source": ["print(1)\n"]
  },
  {
   "cell_type": "markdown",
   "id": "bbbb2222",
   "metadata": {},
   "source": ["# Notes\n"]
  }
 ],
 "metadata": {},
 "nbformat": 4,
 "nbformat_minor": 5
}`

// The same notebook run again: a new execution count and a new output, and not one character of code
// changed.
const theNotebookRunAgain = `{
 "cells": [
  {
   "cell_type": "code",
   "execution_count": 11,
   "id": "aaaa1111",
   "metadata": {},
   "outputs": [{"output_type": "stream", "name": "stdout", "text": ["1\n", "and more\n"]}],
   "source": ["print(1)\n"]
  },
  {
   "cell_type": "markdown",
   "id": "bbbb2222",
   "metadata": {},
   "source": ["# Notes\n"]
  }
 ],
 "metadata": {},
 "nbformat": 4,
 "nbformat_minor": 5
}`

func writeIn(t *testing.T, dir, name, contents string) {
	t.Helper()
	require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(contents), 0o644))
}

/*
The three comparisons a panel asks for, over one file in all three states at once.

Staged and unstaged are two different pairs of documents, and a file that is committed, staged and then
edited again is the one case where all three versions differ — so a comparison reading the wrong pair
cannot come out looking right by coincidence.
*/
func TestTheTwoSidesAreTheOnesTheQuestionAskedAbout(t *testing.T) {
	dir := projectRepo(t)

	writeIn(t, dir, "notes.txt", "committed\n")
	gitIn(t, dir, "add", "notes.txt")
	gitIn(t, dir, "commit", "-m", "the first one")

	writeIn(t, dir, "notes.txt", "staged\n")
	gitIn(t, dir, "add", "notes.txt")
	writeIn(t, dir, "notes.txt", "on disk\n")

	repo, root, err := openRepo()
	require.NoError(t, err)

	t.Run("staged is what a commit would record", func(t *testing.T) {
		diff, err := getDiff(repo, root, "notes.txt", "", true, "")
		require.NoError(t, err)
		assert.Equal(t, "committed\n", diff.Original)
		assert.Equal(t, "staged\n", diff.Modified)
	})

	t.Run("unstaged is what a commit would leave behind", func(t *testing.T) {
		diff, err := getDiff(repo, root, "notes.txt", "", false, "")
		require.NoError(t, err)
		assert.Equal(t, "staged\n", diff.Original)
		assert.Equal(t, "on disk\n", diff.Modified)
	})

	t.Run("a commit is against its parent", func(t *testing.T) {
		// The root commit, whose parent is nothing: every file in it is an addition, which is what git
		// says about one too.
		diff, err := getDiff(repo, root, "notes.txt", "", false, "HEAD")
		require.NoError(t, err)
		assert.Empty(t, diff.Original)
		assert.Equal(t, "committed\n", diff.Modified)

		gitIn(t, dir, "commit", "-am", "the second one")
		diff, err = getDiff(repo, root, "notes.txt", "", false, "HEAD")
		require.NoError(t, err)
		assert.Equal(t, "committed\n", diff.Original)
		assert.Equal(t, "on disk\n", diff.Modified)
	})
}

// An added file has no original and a deleted one has no modified version, which is what makes them read
// as a whole addition and a whole deletion with no flag for either.
func TestAnAddedFileHasNoOriginalAndADeletedFileHasNoModifiedVersion(t *testing.T) {
	dir := projectRepo(t)

	writeIn(t, dir, "notes.txt", "committed\n")
	gitIn(t, dir, "add", "notes.txt")
	gitIn(t, dir, "commit", "-m", "the first one")
	writeIn(t, dir, "new.txt", "brand new\n")
	require.NoError(t, os.Remove(filepath.Join(dir, "notes.txt")))

	repo, root, err := openRepo()
	require.NoError(t, err)

	// Untracked: the index has nothing at that path, so the left side is empty rather than absent.
	added, err := getDiff(repo, root, "new.txt", "", false, "")
	require.NoError(t, err)
	assert.Empty(t, added.Original)
	assert.Equal(t, "brand new\n", added.Modified)

	deleted, err := getDiff(repo, root, "notes.txt", "", false, "")
	require.NoError(t, err)
	assert.Equal(t, "committed\n", deleted.Original)
	assert.Empty(t, deleted.Modified)
}

/*
A path neither side has is refused rather than answered with two empty documents.

An empty comparison of nothing is indistinguishable from a file that has not changed, and the way to get
one is a stale panel — a row clicked after the file behind it was committed or discarded in a terminal.
*/
func TestAPathOnNeitherSideIsNotAnEmptyComparison(t *testing.T) {
	dir := projectRepo(t)

	writeIn(t, dir, "notes.txt", "committed\n")
	gitIn(t, dir, "add", "notes.txt")
	gitIn(t, dir, "commit", "-m", "the first one")

	repo, root, err := openRepo()
	require.NoError(t, err)

	_, err = getDiff(repo, root, "never-existed.txt", "", false, "")
	var missing *missingPath
	require.ErrorAs(t, err, &missing)

	// A ref the repository does not have is the other way to be stale, and is its own answer.
	_, err = getDiff(repo, root, "notes.txt", "", false, "0000000000000000000000000000000000000000")
	var unknown *notFound
	assert.ErrorAs(t, err, &unknown)
}

/*
A renamed file is compared against the name it had.

Without the old name the original side is a path that only the new tree has, so the whole file reads as
added and nothing reads as deleted — which is the one thing a rename is not.
*/
func TestARenamedFileIsComparedAgainstTheNameItHad(t *testing.T) {
	dir := projectRepo(t)

	writeIn(t, dir, "notes.txt", "the same contents\n")
	gitIn(t, dir, "add", "notes.txt")
	gitIn(t, dir, "commit", "-m", "the first one")
	gitIn(t, dir, "mv", "notes.txt", "renamed.txt")

	repo, root, err := openRepo()
	require.NoError(t, err)

	diff, err := getDiff(repo, root, "renamed.txt", "notes.txt", true, "")
	require.NoError(t, err)
	assert.Equal(t, "notes.txt", diff.From)
	assert.Equal(t, "the same contents\n", diff.Original)
	assert.Equal(t, "the same contents\n", diff.Modified, "a rename with no edit is two identical sides")
}

/*
A notebook is compared as the source of its cells, and nothing else.

The point of the whole notebook path: run a notebook twice and change no code, and the file differs by
its execution counts and every line of its outputs. Compared raw, that is a diff of base64 and renumbered
counts; compared as cells, it is two identical documents — which is the truth about the code.
*/
func TestANotebookIsComparedAsItsCellSources(t *testing.T) {
	dir := projectRepo(t)

	writeIn(t, dir, "analysis.ipynb", aNotebook)
	gitIn(t, dir, "add", "analysis.ipynb")
	gitIn(t, dir, "commit", "-m", "the first one")
	writeIn(t, dir, "analysis.ipynb", theNotebookRunAgain)

	repo, root, err := openRepo()
	require.NoError(t, err)

	diff, err := getDiff(repo, root, "analysis.ipynb", "", false, "")
	require.NoError(t, err)
	assert.True(t, diff.IsNotebook, "the viewer has to be able to say it is not showing the whole file")

	expected := "# %% [1] code\nprint(1)\n\n# %% [2] markdown\n# Notes\n"
	assert.Equal(t, expected, diff.Original)
	assert.Equal(t, diff.Original, diff.Modified, "nothing about the code changed")

	for _, unwanted := range []string{"execution_count", "output", "nbformat", "aaaa1111"} {
		assert.NotContains(t, diff.Original, unwanted)
	}

	// And an edit to a cell is one line of the comparison rather than one line of a JSON document.
	writeIn(t, dir, "analysis.ipynb", strings.Replace(theNotebookRunAgain, "print(1)", "print(2)", 1))
	diff, err = getDiff(repo, root, "analysis.ipynb", "", false, "")
	require.NoError(t, err)
	assert.Equal(t, expected, diff.Original)
	assert.Equal(t, strings.Replace(expected, "print(1)", "print(2)", 1), diff.Modified)
}

/*
A file with the notebook extension that is not a notebook is compared as the text it is.

A conflicted .ipynb has git's markers in the middle of its JSON, and half a notebook rendered as cells
beside a whole one is every line changed. The raw text is a worse diff than cells and a much better one
than that.
*/
func TestSomethingThatIsNotAReadableNotebookIsComparedAsText(t *testing.T) {
	dir := projectRepo(t)

	writeIn(t, dir, "broken.ipynb", "{not json at all\n")
	gitIn(t, dir, "add", "broken.ipynb")
	gitIn(t, dir, "commit", "-m", "the first one")
	writeIn(t, dir, "broken.ipynb", "{still not json\n")

	repo, root, err := openRepo()
	require.NoError(t, err)

	diff, err := getDiff(repo, root, "broken.ipynb", "", false, "")
	require.NoError(t, err)
	assert.False(t, diff.IsNotebook)
	assert.Equal(t, "{not json at all\n", diff.Original)
	assert.Equal(t, "{still not json\n", diff.Modified)
}

// A binary file is reported as one rather than sent: two columns of NUL bytes are not a comparison
// anybody reads, and a browser asked to diff them line by line has been given a job with no answer.
func TestABinaryFileIsReportedRatherThanSent(t *testing.T) {
	dir := projectRepo(t)

	require.NoError(t, os.WriteFile(filepath.Join(dir, "logo.png"),
		[]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), 0o644))
	gitIn(t, dir, "add", "logo.png")
	gitIn(t, dir, "commit", "-m", "the first one")
	require.NoError(t, os.WriteFile(filepath.Join(dir, "logo.png"),
		[]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRx"), 0o644))

	repo, root, err := openRepo()
	require.NoError(t, err)

	diff, err := getDiff(repo, root, "logo.png", "", false, "")
	require.NoError(t, err)
	assert.True(t, diff.IsBinary)
	assert.Empty(t, diff.Original)
	assert.Empty(t, diff.Modified)
}

/*
A file over the limit is refused with a reason rather than sent.

Both sides are held here, encoded into one response and then handed to a diff algorithm in a browser
tab, so the failure mode of sending a very large file is not an unhelpful diff — it is a tab that stops
responding.
*/
func TestAFileTooLargeToCompareSaysSo(t *testing.T) {
	dir := projectRepo(t)

	writeIn(t, dir, "big.txt", "small\n")
	gitIn(t, dir, "add", "big.txt")
	gitIn(t, dir, "commit", "-m", "the first one")
	writeIn(t, dir, "big.txt", strings.Repeat("a line of text\n", (maxDiffBytes/15)+100))

	repo, root, err := openRepo()
	require.NoError(t, err)

	diff, err := getDiff(repo, root, "big.txt", "", false, "")
	require.NoError(t, err)
	assert.True(t, diff.TooLarge)
	assert.Empty(t, diff.Modified)
}

/*
A conflicted file is compared against the version that is being merged into, not the base.

The index holds three versions during a merge and go-git's own lookup answers with whichever comes
first, which is the merge base — comparing against that describes the other branch's work as well as
this one's, in a file whose worktree side is a set of conflict markers.
*/
func TestAConflictedFileIsComparedAgainstOurs(t *testing.T) {
	dir := projectRepo(t)

	writeIn(t, dir, "notes.txt", "base\n")
	gitIn(t, dir, "add", "notes.txt")
	gitIn(t, dir, "commit", "-m", "the first one")
	main := strings.TrimSpace(gitIn(t, dir, "rev-parse", "--abbrev-ref", "HEAD"))

	gitIn(t, dir, "checkout", "-b", "other")
	writeIn(t, dir, "notes.txt", "theirs\n")
	gitIn(t, dir, "commit", "-am", "theirs")

	gitIn(t, dir, "checkout", main)
	writeIn(t, dir, "notes.txt", "ours\n")
	gitIn(t, dir, "commit", "-am", "ours")

	// Expected to fail: that is the conflict this is about.
	_, err := run(t.Context(), dir, "merge", "other")
	require.Error(t, err)

	repo, root, err := openRepo()
	require.NoError(t, err)

	diff, err := getDiff(repo, root, "notes.txt", "", false, "")
	require.NoError(t, err)
	assert.Equal(t, "ours\n", diff.Original)
	assert.Contains(t, diff.Modified, "<<<<<<<", "the worktree side of a conflict is the markers git wrote")
}
