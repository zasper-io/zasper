/*
The file suggestions behind the command palette's file half.

The handler lists a project once and answers every query from that listing until it is listingTTL old.
Each test has a handler of its own, so they run in parallel.
*/
package search

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/models"
)

// projectWith lays out a project of the given files — each path is project-relative, and parents are
// created as needed — and answers a handler for it and its directory. The test runs in parallel.
func projectWith(t *testing.T, paths ...string) (*Handler, string) {
	t.Helper()
	t.Parallel()

	dir := t.TempDir()
	for _, path := range paths {
		full := filepath.Join(dir, filepath.FromSlash(path))
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
		require.NoError(t, os.WriteFile(full, []byte("x"), 0o644))
	}
	return NewHandler(content.NewProject(dir)), dir
}

// suggestions calls the handler and answers the status and what it offered.
func suggestions(t *testing.T, h *Handler, query string) (int, []models.ContentModel) {
	t.Helper()

	target := "/api/files"
	if query != "" {
		target += "?query=" + query
	}
	recorder := httptest.NewRecorder()
	h.Files(recorder, httptest.NewRequest(http.MethodGet, target, nil))

	if recorder.Code != http.StatusOK {
		return recorder.Code, nil
	}

	var found []models.ContentModel
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &found), "body was %s", recorder.Body)
	return recorder.Code, found
}

// suggest is suggestions reduced to the paths offered.
func suggest(t *testing.T, h *Handler, query string) (int, []string) {
	t.Helper()

	status, found := suggestions(t, h, query)
	paths := make([]string, len(found))
	for i, f := range found {
		paths[i] = f.Path
	}
	return status, paths
}

func TestAQueryIsRequired(t *testing.T) {
	h, _ := projectWith(t, "notes.txt")

	status, _ := suggest(t, h, "")

	assert.Equal(t, http.StatusBadRequest, status)
}

func TestFilesAreMatchedOnTheirNameWhateverTheCase(t *testing.T) {
	h, _ := projectWith(t, "README.md", "src/reader.py", "src/writer.py", "data/table.csv")

	status, paths := suggest(t, h, "READ")

	require.Equal(t, http.StatusOK, status)
	assert.ElementsMatch(t, []string{"README.md", "src/reader.py"}, paths)
}

func TestSuggestionsArePathsInsideTheProject(t *testing.T) {
	h, _ := projectWith(t, "src/deep/inside.py")

	status, paths := suggest(t, h, "inside")

	require.Equal(t, http.StatusOK, status)
	// Project-relative, as everything the client sends back to the server has to be — never the
	// absolute path this process happens to be walking.
	require.Equal(t, []string{"src/deep/inside.py"}, paths)
	assert.False(t, filepath.IsAbs(paths[0]))
}

func TestNothingMatchingIsAnEmptyAnswerRatherThanAnError(t *testing.T) {
	h, _ := projectWith(t, "notes.txt")

	status, paths := suggest(t, h, "nothingliketh1s")

	assert.Equal(t, http.StatusOK, status)
	assert.Empty(t, paths)
}

/*
Git's own directory is hidden; files that merely begin the same way are not.

The skip was once `strings.Contains(path, ".git")` over the whole path, so it also swallowed `.gitignore`,
`.gitattributes` and everything under `.github/`.
*/
func TestTheGitDirectoryIsHiddenButGitFilesAreNot(t *testing.T) {
	h, _ := projectWith(t,
		// Named so they would match the query on their own, which is what makes their absence from the
		// answer mean the directory was skipped rather than the name simply not matching.
		".git/gitconfig",
		".git/refs/heads/gitmain",
		".gitignore",
		".gitattributes",
		".github/workflows/gitflow.yml",
	)

	status, paths := suggest(t, h, "git")

	require.Equal(t, http.StatusOK, status)
	assert.ElementsMatch(t, []string{".gitignore", ".gitattributes", ".github/workflows/gitflow.yml"}, paths)
}

func TestOneWalkAnswersEveryQueryUntilItIsStale(t *testing.T) {
	h, dir := projectWith(t, "alpha-one.txt", "beta-one.txt")

	_, first := suggest(t, h, "alpha")
	require.Equal(t, []string{"alpha-one.txt"}, first)

	// Written after the walk, so it can only appear if the project is walked again.
	require.NoError(t, os.WriteFile(filepath.Join(dir, "beta-two.txt"), []byte("x"), 0o644))

	_, second := suggest(t, h, "beta")
	assert.Equal(t, []string{"beta-one.txt"}, second, "a different query walked the project again")

	h.ttl = 0

	_, third := suggest(t, h, "beta")
	assert.ElementsMatch(t, []string{"beta-one.txt", "beta-two.txt"}, third, "a stale listing was not walked again")
}

// Two projects, one query: each handler answers from its own project.
func TestAnotherProjectIsNotAnsweredFromThisOnesListing(t *testing.T) {
	first, _ := projectWith(t, "shared-name-here.txt")
	_, found := suggest(t, first, "shared-name-here")
	require.Equal(t, []string{"shared-name-here.txt"}, found)

	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "elsewhere"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "elsewhere", "shared-name-here.txt"), []byte("x"), 0o644))
	_, found = suggest(t, NewHandler(content.NewProject(dir)), "shared-name-here")

	assert.Equal(t, []string{"elsewhere/shared-name-here.txt"}, found)
}

func TestIgnoredFilesAndFoldersAreNotSuggested(t *testing.T) {
	h, dir := projectWith(t,
		"build/report-x.txt",
		"node_modules/pkg/report-x.js",
		".venv/lib/report-x.py",
		"debug-report-x.log",
		"tests/report-x.py",
	)
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".gitignore"), []byte("build/\n*.log\n"), 0o644))

	_, paths := suggest(t, h, "report-x")

	assert.Equal(t, []string{"tests/report-x.py"}, paths)
}

func TestAnUnreadableFolderDoesNotFailTheSearch(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs a folder the test cannot read")
	}
	h, dir := projectWith(t, "locked/secret-y.txt", "open/notes-y.txt")
	locked := filepath.Join(dir, "locked")
	require.NoError(t, os.Chmod(locked, 0))
	t.Cleanup(func() { os.Chmod(locked, 0o755) })

	status, paths := suggest(t, h, "-y")

	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, []string{"open/notes-y.txt"}, paths)
}

func TestAShortQueryInALargeProjectIsCapped(t *testing.T) {
	names := make([]string, maxSuggestions+10)
	for i := range names {
		names[i] = fmt.Sprintf("file-%d.txt", i)
	}
	h, _ := projectWith(t, names...)

	_, paths := suggest(t, h, "file")

	assert.Len(t, paths, maxSuggestions)
}

func TestASuggestionSaysWhatItIsAndWhenItChanged(t *testing.T) {
	h, _ := projectWith(t, "analysis.ipynb", "analysis.py")

	_, found := suggestions(t, h, "analysis")
	require.Len(t, found, 2)

	for _, suggestion := range found {
		want := "file"
		if suggestion.Name == "analysis.ipynb" {
			want = "notebook"
		}
		assert.Equal(t, want, suggestion.ContentType, suggestion.Name)
		_, err := time.Parse(time.RFC3339, suggestion.LastModified)
		assert.NoError(t, err, "last_modified %q is not RFC 3339", suggestion.LastModified)
	}
}
