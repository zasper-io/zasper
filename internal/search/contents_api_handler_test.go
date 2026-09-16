/*
Searching file contents, and replacing across them.

Every search test runs once searching without ripgrep and once with it, when there is one to run — on PATH,
or named by ZASPER_TEST_RIPGREP — because the two must answer the same.
*/
package search

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/content"
)

func ripgrepForTests() string {
	if named := os.Getenv("ZASPER_TEST_RIPGREP"); named != "" {
		return named
	}
	found, _ := exec.LookPath("rg")
	return found
}

// eachEngine runs test against a project laid out from files, once per way of searching it.
func eachEngine(t *testing.T, files map[string]string, test func(t *testing.T, h *Handler, dir string)) {
	t.Helper()
	t.Parallel()
	engines := map[string]string{"go": ""}
	if rg := ripgrepForTests(); rg != "" {
		engines["ripgrep"] = rg
	}
	for name, binary := range engines {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			dir := t.TempDir()
			for path, text := range files {
				full := filepath.Join(dir, filepath.FromSlash(path))
				require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
				require.NoError(t, os.WriteFile(full, []byte(text), 0o644))
			}
			h := NewHandler(content.NewProject(dir))
			h.ripgrep = binary
			test(t, h, dir)
		})
	}
}

func post(t *testing.T, handler http.HandlerFunc, body any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(body)
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	handler(recorder, httptest.NewRequest(http.MethodPost, "/api/search", bytes.NewReader(encoded)))
	return recorder
}

// searched answers the files a search found, by path, and its summary.
func searched(t *testing.T, h *Handler, query Query) (map[string]FileMatches, Summary) {
	t.Helper()
	recorder := post(t, h.Search, query)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())

	files := map[string]FileMatches{}
	var summary *Summary
	lines := bufio.NewScanner(recorder.Body)
	lines.Buffer(make([]byte, 1<<20), 16<<20)
	for lines.Scan() {
		var event searchEvent
		require.NoError(t, json.Unmarshal(lines.Bytes(), &event))
		require.Nil(t, summary, "a line came after the summary")
		if event.File != nil {
			files[event.File.Path] = *event.File
		}
		summary = event.Done
	}
	require.NotNil(t, summary, "the search ended without a summary")
	return files, *summary
}

func paths(files map[string]FileMatches) []string {
	names := []string{}
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func TestContentsAreSearchedALineAtATime(t *testing.T) {
	eachEngine(t, map[string]string{
		"prepare.py": "import pandas\nframe = load()\nframe = frame.dropna()\n",
		"notes.txt":  "nothing here\n",
	}, func(t *testing.T, h *Handler, _ string) {
		files, summary := searched(t, h, Query{Pattern: "frame"})

		require.Equal(t, []string{"prepare.py"}, paths(files))
		file := files["prepare.py"]
		assert.Equal(t, "file", file.Kind)
		require.Len(t, file.Lines, 2)
		assert.Equal(t, 2, file.Lines[0].Line)
		assert.Equal(t, "frame = load()", file.Lines[0].Text)
		assert.Equal(t, []Range{{From: 0, To: 5}, {From: 8, To: 13}}, file.Lines[1].Ranges)
		assert.Equal(t, Summary{Files: 1, Matches: 3}, summary)
	})
}

// The editor counts positions in UTF-16, so a column in bytes would put the cursor late after an emoji.
func TestRangesCountWhatTheEditorCounts(t *testing.T) {
	eachEngine(t, map[string]string{"notes.md": "😀 é frame\r\n"}, func(t *testing.T, h *Handler, _ string) {
		files, _ := searched(t, h, Query{Pattern: "frame"})

		line := files["notes.md"].Lines[0]
		assert.Equal(t, "😀 é frame", line.Text, "the carriage return is not part of the line")
		assert.Equal(t, []Range{{From: 5, To: 10}}, line.Ranges)
	})
}

func TestTheFindCardsOptionsMeanWhatTheySayInTheEditor(t *testing.T) {
	eachEngine(t, map[string]string{
		"a.py": "Frame\nframes\nframe\n",
	}, func(t *testing.T, h *Handler, _ string) {
		count := func(query Query) int {
			_, summary := searched(t, h, query)
			return summary.Matches
		}
		assert.Equal(t, 3, count(Query{Pattern: "frame"}))
		assert.Equal(t, 2, count(Query{Pattern: "frame", CaseSensitive: true}))
		assert.Equal(t, 2, count(Query{Pattern: "frame", WholeWord: true}))
		assert.Equal(t, 1, count(Query{Pattern: "^fr.mes$", Regexp: true}))
		assert.Equal(t, 0, count(Query{Pattern: "fr.me"}), "a literal dot is not a wildcard")
	})
}

func TestAReplacementIsWorkedOutForEachMatch(t *testing.T) {
	eachEngine(t, map[string]string{"a.py": "frame and flame\n"}, func(t *testing.T, h *Handler, _ string) {
		replace := "[$2$1]($&)"
		files, _ := searched(t, h, Query{Pattern: `(f)(r|l)ame`, Regexp: true, Replace: &replace})

		ranges := files["a.py"].Lines[0].Ranges
		require.Len(t, ranges, 2)
		assert.Equal(t, "[rf](frame)", *ranges[0].Replacement)
		assert.Equal(t, "[lf](flame)", *ranges[1].Replacement)
	})
}

func TestABadPatternIsRefusedWithWhatIsWrongWithIt(t *testing.T) {
	h := NewHandler(content.NewProject(t.TempDir()))

	recorder := post(t, h.Search, Query{Pattern: "(frame", Regexp: true})

	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "Bad pattern: missing closing )")
	assert.Equal(t, http.StatusBadRequest, post(t, h.Search, Query{}).Code)
}

func TestWhatTheFileBrowserLeavesOutIsNotSearched(t *testing.T) {
	eachEngine(t, map[string]string{
		".gitignore":            "build/\n*.log\n",
		"build/out.py":          "needle\n",
		"debug.log":             "needle\n",
		"node_modules/x/i.js":   "needle\n",
		".git/config":           "needle\n",
		"blob.bin":              "needle\x00\x01",
		"latin1.txt":            "needle caf\xe9\n",
		".github/workflows/a.y": "needle\n",
		"src/kept.py":           "needle\n",
	}, func(t *testing.T, h *Handler, _ string) {
		files, _ := searched(t, h, Query{Pattern: "needle"})

		assert.Equal(t, []string{".github/workflows/a.y", "src/kept.py"}, paths(files))
	})
}

func TestTheFileFiltersNarrowTheSearch(t *testing.T) {
	eachEngine(t, map[string]string{
		"src/model/drift.py": "needle\n",
		"src/prepare.py":     "needle\n",
		"tests/test_a.py":    "needle\n",
		"README.md":          "needle\n",
	}, func(t *testing.T, h *Handler, _ string) {
		found := func(include, exclude string) []string {
			files, _ := searched(t, h, Query{Pattern: "needle", Include: include, Exclude: exclude})
			return paths(files)
		}
		assert.Equal(t, []string{"src/model/drift.py", "src/prepare.py", "tests/test_a.py"}, found("*.py", ""))
		assert.Equal(t, []string{"README.md", "src/model/drift.py", "src/prepare.py"}, found("", "tests/"))
		assert.Equal(t, []string{"src/model/drift.py"}, found("src/model/**", ""))
		assert.Equal(t, []string{"README.md"}, found("*.md, tests", "tests"))
	})
}

const notebookOnDisk = `{
 "cells": [
  {
   "cell_type": "code",
   "execution_count": 1,
   "metadata": {},
   "outputs": [
    {"name": "stdout", "output_type": "stream", "text": ["frame has 20160 rows\n"]}
   ],
   "source": ["frame = load(\"rows.csv\")\n", "frame.head()"]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": ["# The frame"]
  }
 ],
 "metadata": {},
 "nbformat": 4,
 "nbformat_minor": 4
}
`

// A notebook is searched as its cells (story 18): the text the notebook shows, not the JSON on disk.
func TestANotebookIsSearchedAsItsCells(t *testing.T) {
	eachEngine(t, map[string]string{"analysis.ipynb": notebookOnDisk}, func(t *testing.T, h *Handler, _ string) {
		files, summary := searched(t, h, Query{Pattern: "frame"})

		file := files["analysis.ipynb"]
		assert.Equal(t, "notebook", file.Kind)
		require.Len(t, file.Lines, 4)

		assert.Equal(t, `frame = load("rows.csv")`, file.Lines[0].Text, "the quotes are not escaped")
		assert.Equal(t, 0, *file.Lines[0].Cell)
		assert.False(t, file.Lines[0].Output)

		assert.Equal(t, 2, file.Lines[1].Line)
		assert.Equal(t, "frame has 20160 rows", file.Lines[2].Text)
		assert.True(t, file.Lines[2].Output)
		assert.Equal(t, 1, *file.Lines[3].Cell)
		assert.Equal(t, 4, summary.Matches)
	})
}

func TestASearchStopsAtItsCapAndSaysSo(t *testing.T) {
	eachEngine(t, map[string]string{
		"many.txt": strings.Repeat("hit\n", maxMatches+50),
	}, func(t *testing.T, h *Handler, _ string) {
		files, summary := searched(t, h, Query{Pattern: "hit"})

		assert.True(t, summary.Capped)
		assert.Equal(t, maxMatches, summary.Matches)
		assert.Len(t, files["many.txt"].Lines, maxMatches)
	})
}

func TestOnlyTheStretchOfAVeryLongLineAroundItsMatchIsSent(t *testing.T) {
	line := strings.Repeat("a", 4000) + "needle" + strings.Repeat("b", 4000)
	eachEngine(t, map[string]string{"min.js": line}, func(t *testing.T, h *Handler, _ string) {
		files, _ := searched(t, h, Query{Pattern: "needle"})

		match := files["min.js"].Lines[0]
		assert.LessOrEqual(t, len(match.Text), maxLineText)
		assert.Equal(t, []Range{{From: 4000, To: 4006}}, match.Ranges, "ranges count from the line's start")
		assert.Equal(t, "needle", match.Text[4000-match.Offset:4006-match.Offset])
	})
}

func TestReplacingWritesEveryMatchButTheOnesLeftOut(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "a.py"), []byte("frame = frame\r\nframe\r\n"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "analysis.ipynb"), []byte(notebookOnDisk), 0o644))
	h := NewHandler(content.NewProject(dir))
	replace := "table"
	zero := 0

	recorder := post(t, h.Replace, replaceRequest{
		Query: Query{Pattern: "frame", Replace: &replace},
		Files: []ReplaceFile{
			{Path: "a.py", Skip: []MatchKey{{Line: 1, From: 8}}},
			{Path: "analysis.ipynb", Skip: []MatchKey{{Cell: &zero, Line: 2, From: 0}}},
			{Path: "../outside.py"},
		},
	})

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var answer replaceResponse
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &answer))
	assert.Equal(t, 2, answer.Files)
	assert.Equal(t, 4, answer.Replacements)
	require.Len(t, answer.Failed, 1)
	assert.Equal(t, "../outside.py", answer.Failed[0].Path)

	text, err := os.ReadFile(filepath.Join(dir, "a.py"))
	require.NoError(t, err)
	assert.Equal(t, "table = frame\r\ntable\r\n", string(text), "the line endings are kept")

	notebook, err := os.ReadFile(filepath.Join(dir, "analysis.ipynb"))
	require.NoError(t, err)
	var doc map[string]any
	require.NoError(t, json.Unmarshal(notebook, &doc))
	cells := doc["cells"].([]any)
	first := cells[0].(map[string]any)
	assert.Equal(t, []any{"table = load(\"rows.csv\")\n", "frame.head()"}, first["source"])
	assert.Equal(t, []any{"frame has 20160 rows\n"}, first["outputs"].([]any)[0].(map[string]any)["text"], "an output is never replaced")
	assert.Equal(t, []any{"# The table"}, cells[1].(map[string]any)["source"])
	assert.EqualValues(t, 4, doc["nbformat_minor"], "the notebook keeps its own version")
}

func TestAPreviewIsTheFileBeforeAndAfter(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "a.py"), []byte("frame.head()\n"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "analysis.ipynb"), []byte(notebookOnDisk), 0o644))
	h := NewHandler(content.NewProject(dir))
	replace := "table"
	query := Query{Pattern: "frame", Replace: &replace}

	recorder := post(t, h.Preview, previewRequest{Query: query, Path: "a.py"})
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var answer previewResponse
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &answer))
	assert.Equal(t, previewResponse{Original: "frame.head()\n", Replaced: "table.head()\n"}, answer)

	unchanged, err := os.ReadFile(filepath.Join(dir, "a.py"))
	require.NoError(t, err)
	assert.Equal(t, "frame.head()\n", string(unchanged), "a preview writes nothing")

	assert.Equal(t, http.StatusBadRequest, post(t, h.Preview, previewRequest{Query: query, Path: "analysis.ipynb"}).Code)
	assert.Equal(t, http.StatusNotFound, post(t, h.Preview, previewRequest{Query: query, Path: "gone.py"}).Code)
}

func TestGlobs(t *testing.T) {
	cases := []struct {
		glob, path string
		want       bool
	}{
		{"*.py", "src/a.py", true},
		{"tests", "tests/unit/a.py", true},
		{"tests", "src/tests.py", false},
		{"src/model", "src/model/a.py", true},
		{"src/model", "lib/src/model/a.py", false},
		{"src/*/a.py", "src/model/a.py", true},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, anyGlob(globList(c.glob), c.path), "%s against %s", c.glob, c.path)
	}
}

// A file open in an editor may hold text that is not on disk yet, and the panel asks about that text here.
func TestTheTextAnEditorHoldsIsSearchedThroughTheSameEngine(t *testing.T) {
	h := NewHandler(content.NewProject(t.TempDir()))
	replace := "table"

	recorder := post(t, h.Buffer, bufferRequest{
		Query: Query{Pattern: "frame", Replace: &replace},
		Path:  "src/prepare.py",
		Text:  "frame = load()\nnothing\n",
	})

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var answer FileMatches
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &answer))
	assert.Equal(t, "file", answer.Kind)
	require.Len(t, answer.Lines, 1)
	assert.Equal(t, "frame = load()", answer.Lines[0].Text)
	assert.Equal(t, "table", *answer.Lines[0].Ranges[0].Replacement)

	empty := post(t, h.Buffer, bufferRequest{Query: Query{Pattern: "frame"}, Path: "a.txt", Text: "nothing here"})
	require.NoError(t, json.Unmarshal(empty.Body.Bytes(), &answer))
	assert.Empty(t, answer.Lines)

	// A notebook's unsaved text is still its cells, not the JSON.
	notebook := post(t, h.Buffer, bufferRequest{Query: Query{Pattern: "frame"}, Path: "analysis.ipynb", Text: notebookOnDisk})
	require.NoError(t, json.Unmarshal(notebook.Body.Bytes(), &answer))
	assert.Equal(t, "notebook", answer.Kind)
	assert.NotEmpty(t, answer.Lines)

	assert.Equal(t, http.StatusBadRequest, post(t, h.Buffer, bufferRequest{Query: Query{Pattern: "x"}}).Code)
}
