/*
The file suggestions behind the command palette's file half.

This handler had no coverage at all — not a unit test, and no end-to-end journey either, since
internal/server/auth_test.go only ever sees it answer 401. It walks the whole project on every miss
and keeps what it found in a package-level cache, so the things worth pinning are what it matches,
what it hides, and what that cache does when the query is chosen by somebody else.

The cache is process-wide, so each test uses a query of its own rather than resetting it — the same
habit the store tests keep, for the same reason.
*/
package search

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/models"
)

// projectWith lays out a project of the given files — each path is project-relative, and parents are
// created as needed — and points core.Zasper at it for the length of the test.
func projectWith(t *testing.T, paths ...string) string {
	t.Helper()

	dir := t.TempDir()
	for _, path := range paths {
		full := filepath.Join(dir, filepath.FromSlash(path))
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
		require.NoError(t, os.WriteFile(full, []byte("x"), 0o644))
	}

	previous := core.Zasper.HomeDir
	core.Zasper.HomeDir = dir
	t.Cleanup(func() { core.Zasper.HomeDir = previous })

	return dir
}

// suggest calls the handler and answers the status and the paths it offered.
func suggest(t *testing.T, query string) (int, []string) {
	t.Helper()

	target := "/api/files"
	if query != "" {
		target += "?query=" + query
	}
	recorder := httptest.NewRecorder()
	GetFileSuggestions(recorder, httptest.NewRequest(http.MethodGet, target, nil))

	if recorder.Code != http.StatusOK {
		return recorder.Code, nil
	}

	var found []models.ContentModel
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &found), "body was %s", recorder.Body)

	paths := make([]string, len(found))
	for i, f := range found {
		paths[i] = filepath.ToSlash(f.Path)
	}
	return recorder.Code, paths
}

func TestAQueryIsRequired(t *testing.T) {
	projectWith(t, "notes.txt")

	status, _ := suggest(t, "")

	assert.Equal(t, http.StatusBadRequest, status)
}

func TestFilesAreMatchedOnTheirNameWhateverTheCase(t *testing.T) {
	projectWith(t, "README.md", "src/reader.py", "src/writer.py", "data/table.csv")

	status, paths := suggest(t, "READ")

	require.Equal(t, http.StatusOK, status)
	// The palette matches its commands case-insensitively and one query box whose two halves
	// disagree about `README` and `readme` is a bug report.
	assert.ElementsMatch(t, []string{"README.md", "src/reader.py"}, paths)
}

func TestSuggestionsArePathsInsideTheProject(t *testing.T) {
	projectWith(t, "src/deep/inside.py")

	status, paths := suggest(t, "inside")

	require.Equal(t, http.StatusOK, status)
	// Project-relative, as everything the client sends back to the server has to be — never the
	// absolute path this process happens to be walking.
	require.Equal(t, []string{"src/deep/inside.py"}, paths)
	assert.False(t, filepath.IsAbs(paths[0]))
}

func TestNothingMatchingIsAnEmptyAnswerRatherThanAnError(t *testing.T) {
	projectWith(t, "notes.txt")

	status, paths := suggest(t, "nothingliketh1s")

	assert.Equal(t, http.StatusOK, status)
	assert.Empty(t, paths)
}

/*
Git's own directory is hidden; files that merely begin the same way are not.

The skip was `strings.Contains(path, ".git")` over the whole path, so it also swallowed `.gitignore`,
`.gitattributes` and everything under `.github/` — files a reader would expect to be able to open,
and the last of which is a directory of workflows people edit.
*/
func TestTheGitDirectoryIsHiddenButGitFilesAreNot(t *testing.T) {
	projectWith(t,
		// Named so they would match the query on their own, which is what makes their absence from
		// the answer mean the directory was skipped rather than the name simply not matching.
		".git/gitconfig",
		".git/refs/heads/gitmain",
		".gitignore",
		".gitattributes",
		".github/workflows/gitflow.yml",
	)

	status, paths := suggest(t, "git")

	require.Equal(t, http.StatusOK, status)
	assert.ElementsMatch(t, []string{
		".gitignore",
		".gitattributes",
		".github/workflows/gitflow.yml",
	}, paths)
}

func TestTheSecondAskForTheSameQueryIsAnsweredFromTheCache(t *testing.T) {
	dir := projectWith(t, "cached-alpha.txt")

	status, first := suggest(t, "cached-alpha")
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, []string{"cached-alpha.txt"}, first)

	// Written after the first answer, so it can only appear if the walk ran again.
	require.NoError(t, os.WriteFile(filepath.Join(dir, "cached-alpha-two.txt"), []byte("x"), 0o644))

	_, second := suggest(t, "cached-alpha")
	assert.Equal(t, first, second, "the walk ran again rather than the cache answering")
}

/*
A cache keyed on what the caller typed cannot grow without limit.

Nothing evicts: the five-minute expiry is only consulted on a read, so it never removes an entry that
is not asked for again. Every distinct query held a full slice of results for the life of the
process, and the query is a URL parameter.
*/
func TestTheCacheDoesNotGrowWithoutBound(t *testing.T) {
	projectWith(t, "notes.txt")

	for i := range maxCachedQueries * 2 {
		_, _ = suggest(t, "flood-"+string(rune('a'+i%26))+string(rune('a'+i/26)))
	}

	held := 0
	cache.Range(func(_, _ any) bool {
		held++
		return true
	})
	assert.LessOrEqual(t, held, maxCachedQueries, "the cache holds %d queries", held)
}

// Two projects, one query. The cache is keyed on the query alone unless it is told otherwise, so a
// second project would be answered with the first one's files.
func TestAnotherProjectIsNotAnsweredFromThisOnesCache(t *testing.T) {
	projectWith(t, "shared-name-here.txt")
	_, first := suggest(t, "shared-name-here")
	require.Equal(t, []string{"shared-name-here.txt"}, first)

	projectWith(t, "elsewhere/shared-name-here.txt")
	_, second := suggest(t, "shared-name-here")

	assert.Equal(t, []string{"elsewhere/shared-name-here.txt"}, second)
}
