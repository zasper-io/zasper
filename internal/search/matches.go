package search

import (
	"bytes"
	"regexp"
	"strings"
	"unicode/utf8"
)

// The most matches one search answers, counted as ranges. Past it the panel says the list is cut.
const maxMatches = 2000

// Files over this are not searched, as they are not opened: the same 10 MB the contents API refuses.
const maxFileSize = 10 << 20

// How much of a very long line is sent: a minified file is one line, and the panel shows a row of it.
const maxLineText = 1000

// Range is one match in a line, in UTF-16 code units from the start of the line.
type Range struct {
	From        int     `json:"from"`
	To          int     `json:"to"`
	Replacement *string `json:"replacement,omitempty"`
}

/*
LineMatch is one line holding at least one match.

Text is the line, or the part of a long one around its first match, and Offset is where that part starts in
the line: the ranges count from the line's start either way, so they can be carried back to the editor.
*/
type LineMatch struct {
	Line   int     `json:"line"`
	Text   string  `json:"text"`
	Offset int     `json:"offset"`
	Ranges []Range `json:"ranges"`
	// In a notebook: which cell, from 0, and whether the line is in what the cell printed rather than
	// in its source. Line then counts within the source or the output.
	Cell   *int `json:"cell,omitempty"`
	Output bool `json:"output,omitempty"`
}

// FileMatches is one file's matching lines. Kind is "notebook" or "file".
type FileMatches struct {
	Path  string      `json:"path"`
	Kind  string      `json:"kind"`
	Lines []LineMatch `json:"lines"`
}

func (f FileMatches) count() int {
	total := 0
	for _, line := range f.Lines {
		total += len(line.Ranges)
	}
	return total
}

// truncated answers the file with no more than budget ranges.
func (f FileMatches) truncated(budget int) FileMatches {
	kept := []LineMatch{}
	for _, line := range f.Lines {
		if budget <= 0 {
			break
		}
		if len(line.Ranges) > budget {
			line.Ranges = line.Ranges[:budget]
		}
		budget -= len(line.Ranges)
		kept = append(kept, line)
	}
	f.Lines = kept
	return f
}

// run is one search: the query compiled, and where it looks.
type run struct {
	root  string
	query Query
	re    *regexp.Regexp
	scope scope
}

func newRun(root string, query Query) (*run, error) {
	re, err := query.compile()
	if err != nil {
		return nil, err
	}
	return &run{root: root, query: query, re: re, scope: newScope(query.Include, query.Exclude)}, nil
}

// lineMatch answers the match for one line, or false when nothing in it matches.
func (r *run) lineMatch(number int, line string) (LineMatch, bool) {
	locs := matchesIn(r.re, line)
	if len(locs) == 0 {
		return LineMatch{}, false
	}

	start, end := 0, len(line)
	if len(line) > maxLineText {
		start = max(0, locs[0][0]-maxLineText/5)
		for start > 0 && !utf8.RuneStart(line[start]) {
			start--
		}
		end = min(len(line), start+maxLineText)
		for end < len(line) && !utf8.RuneStart(line[end]) {
			end--
		}
	}

	offsets := []int{start}
	for _, loc := range locs {
		offsets = append(offsets, loc[0], loc[1])
	}
	cols := columns(line, offsets)

	match := LineMatch{Line: number, Text: line[start:end], Offset: cols[0], Ranges: make([]Range, len(locs))}
	for i, loc := range locs {
		match.Ranges[i] = Range{From: cols[1+2*i], To: cols[2+2*i]}
		if r.query.Replace != nil {
			replacement := expand(*r.query.Replace, r.query.Regexp, line, loc)
			match.Ranges[i].Replacement = &replacement
		}
	}
	return match, true
}

// textMatches answers the matching lines of a text, lines counted from 1.
func (r *run) textMatches(text string) []LineMatch {
	found := []LineMatch{}
	for i, line := range strings.Split(text, "\n") {
		if match, ok := r.lineMatch(i+1, strings.TrimSuffix(line, "\r")); ok {
			found = append(found, match)
		}
	}
	return found
}

// isText answers whether data is something the editor would open as text: UTF-8, with no NUL in it.
func isText(data []byte) bool {
	return bytes.IndexByte(data, 0) < 0 && utf8.Valid(data)
}

func isNotebook(relative string) bool {
	return strings.HasSuffix(strings.ToLower(relative), ".ipynb")
}

// fileMatches searches one file's contents, answering nil when nothing matches or it is not searchable.
func (r *run) fileMatches(relative string, data []byte) *FileMatches {
	if isNotebook(relative) {
		return r.notebookMatches(relative, data)
	}
	if !isText(data) {
		return nil
	}
	lines := r.textMatches(string(data))
	if len(lines) == 0 {
		return nil
	}
	return &FileMatches{Path: relative, Kind: "file", Lines: lines}
}
