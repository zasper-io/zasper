package search

import (
	"fmt"
	"os"
	"strings"

	"github.com/zasper-io/zasper/internal/nbformat"
)

// MatchKey names one match in a file, as the search answered it, so a replace can leave it out.
type MatchKey struct {
	Cell *int `json:"cell,omitempty"`
	Line int  `json:"line"`
	From int  `json:"from"`
}

type matchKey struct{ cell, line, from int }

func keysOf(skip []MatchKey) map[matchKey]bool {
	keys := map[matchKey]bool{}
	for _, key := range skip {
		cell := -1
		if key.Cell != nil {
			cell = *key.Cell
		}
		keys[matchKey{cell, key.Line, key.From}] = true
	}
	return keys
}

/*
replaceText answers text with every match replaced but those in skip, and how many were. Line endings are
kept as they were, a `\r\n` file staying one.
*/
func (r *run) replaceText(text string, cell int, skip map[matchKey]bool) (string, int) {
	replace := ""
	if r.query.Replace != nil {
		replace = *r.query.Replace
	}
	count := 0
	lines := strings.Split(text, "\n")
	for i, raw := range lines {
		line := strings.TrimSuffix(raw, "\r")
		locs := matchesIn(r.re, line)
		if len(locs) == 0 {
			continue
		}
		starts := make([]int, len(locs))
		for j, loc := range locs {
			starts[j] = loc[0]
		}
		cols := columns(line, starts)

		var out strings.Builder
		last := 0
		for j, loc := range locs {
			if skip[matchKey{cell, i + 1, cols[j]}] {
				continue
			}
			out.WriteString(line[last:loc[0]])
			out.WriteString(expand(replace, r.query.Regexp, line, loc))
			last = loc[1]
			count++
		}
		out.WriteString(line[last:])
		lines[i] = out.String() + raw[len(line):]
	}
	return strings.Join(lines, "\n"), count
}

// replaced answers a file's contents before and after replacing, and how many matches were replaced.
func (r *run) replaced(osPath, relative string, skip []MatchKey) (before, after string, count int, err error) {
	info, err := os.Stat(osPath)
	if err != nil {
		return "", "", 0, err
	}
	if info.Size() > maxFileSize {
		return "", "", 0, fmt.Errorf("%s is too large to search", relative)
	}
	data, err := os.ReadFile(osPath)
	if err != nil {
		return "", "", 0, err
	}
	if isNotebook(relative) {
		return "", "", 0, fmt.Errorf("%s is a notebook, which is replaced cell by cell", relative)
	}
	if !isText(data) {
		return "", "", 0, fmt.Errorf("%s is not text", relative)
	}
	before = string(data)
	after, count = r.replaceText(before, -1, keysOf(skip))
	return before, after, count, nil
}

// replacedNotebook answers a notebook with its cells' sources replaced; outputs are never touched.
func (r *run) replacedNotebook(data []byte, skip []MatchKey) (nbformat.Document, int, error) {
	doc, err := nbformat.Read(data)
	if err != nil {
		return nil, 0, err
	}
	keys := keysOf(skip)
	total := 0
	for index, cell := range doc.Cells() {
		source := joined(cell["source"])
		after, count := r.replaceText(source, index, keys)
		if count > 0 {
			cell["source"] = after
			total += count
		}
	}
	return doc, total, nil
}
