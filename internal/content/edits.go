package content

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/zasper-io/zasper/internal/atomicfile"
)

// maxEditFileSize is the largest file an edit is applied to, matching what the editor will open.
const maxEditFileSize = 10 << 20

// Position is a place in a file as the Language Server Protocol counts it: a line from 0, and UTF-16
// code units along that line.
type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

// TextEdit is one replacement in one file, in the protocol's own shape.
type TextEdit struct {
	Start   Position `json:"start"`
	End     Position `json:"end"`
	NewText string   `json:"new_text"`
}

// FileEdits is every edit for one file, project-relative.
type FileEdits struct {
	Path  string     `json:"path"`
	Edits []TextEdit `json:"edits"`
}

// EditResult is what became of one file's edits.
type EditResult struct {
	Path    string `json:"path"`
	Applied int    `json:"applied,omitempty"`
	Error   string `json:"error,omitempty"`
}

/*
ApplyEdits carries out a language server's edits on files no editor holds.

A file open in an editor is edited there instead, so that the change is undoable and so that a notebook
is not written behind its cells; this is the other half of a rename or a quick fix, the files that have
no tab. Each file is read, edited and written whole, atomically, so a crash halfway leaves the file as it
was. A file whose edits cannot be placed is left alone and said so — one bad file does not stop the rest.
*/
func (p Project) ApplyEdits(files []FileEdits) []EditResult {
	results := make([]EditResult, 0, len(files))
	for _, file := range files {
		applied, err := p.applyFileEdits(file)
		result := EditResult{Path: file.Path, Applied: applied}
		if err != nil {
			result.Error = err.Error()
		}
		results = append(results, result)
	}
	return results
}

func (p Project) applyFileEdits(file FileEdits) (int, error) {
	if p.outsideProject(file.Path) {
		return 0, fmt.Errorf("%s is outside the project", file.Path)
	}
	// A notebook is its cells, and an edit counted in a text file's lines does not belong to one.
	if filepath.Ext(file.Path) == ".ipynb" {
		return 0, fmt.Errorf("%s is a notebook, which is edited as cells", file.Path)
	}
	osPath := p.SafePath(file.Path)
	info, err := os.Lstat(osPath)
	if err != nil {
		return 0, err
	}
	if info.IsDir() {
		return 0, fmt.Errorf("%s is a folder", file.Path)
	}
	if info.Size() > maxEditFileSize {
		return 0, fmt.Errorf("%s is larger than 10 MB", file.Path)
	}
	before, err := os.ReadFile(osPath)
	if err != nil {
		return 0, err
	}
	if !utf8.Valid(before) {
		return 0, fmt.Errorf("%s is not UTF-8 text", file.Path)
	}
	after, applied, err := editedBytes(before, file.Edits)
	if err != nil {
		return 0, err
	}
	if applied == 0 {
		return 0, nil
	}
	if _, err := atomicfile.Write(osPath, bytes.NewReader(after), info.Mode().Perm()); err != nil {
		return 0, err
	}
	return applied, nil
}

/*
editedBytes applies edits to text, from the last place in the file to the first so that an earlier edit
never moves a later one. Edits are the server's answer, so they do not overlap; two at the same place keep
the order they arrived in, which is what the protocol says of edits sharing a start.
*/
func editedBytes(text []byte, edits []TextEdit) ([]byte, int, error) {
	starts := lineStarts(text)
	type placed struct {
		from, to int
		order    int
		insert   string
	}
	placements := make([]placed, 0, len(edits))
	for order, edit := range edits {
		from, err := byteOffset(text, starts, edit.Start)
		if err != nil {
			return nil, 0, err
		}
		to, err := byteOffset(text, starts, edit.End)
		if err != nil {
			return nil, 0, err
		}
		if to < from {
			return nil, 0, fmt.Errorf("an edit ends before it starts")
		}
		placements = append(placements, placed{from: from, to: to, order: order, insert: edit.NewText})
	}
	sort.SliceStable(placements, func(i, j int) bool {
		if placements[i].from != placements[j].from {
			return placements[i].from > placements[j].from
		}
		return placements[i].order > placements[j].order
	})

	out := text
	for _, edit := range placements {
		next := make([]byte, 0, len(out)-(edit.to-edit.from)+len(edit.insert))
		next = append(next, out[:edit.from]...)
		next = append(next, edit.insert...)
		next = append(next, out[edit.to:]...)
		out = next
	}
	return out, len(placements), nil
}

// lineStarts is the byte offset each line begins at, counting \n and leaving \r to the line's text.
func lineStarts(text []byte) []int {
	starts := []int{0}
	for index, b := range text {
		if b == '\n' {
			starts = append(starts, index+1)
		}
	}
	return starts
}

/*
byteOffset is where a protocol position falls in the file's bytes.

The protocol counts a column in UTF-16 code units — what a browser's own strings are counted in — so a
line of ASCII needs no conversion and a line with an emoji in it needs two units for that one rune. A
column past the end of its line is the end of that line rather than an error: a server answering about a
version of the file that has since been saved over can name a column that is gone, and refusing the whole
edit over it would lose the rest of a rename.
*/
func byteOffset(text []byte, starts []int, at Position) (int, error) {
	if at.Line < 0 || at.Character < 0 {
		return 0, fmt.Errorf("line %d, character %d is not a place in a file", at.Line, at.Character)
	}
	if at.Line >= len(starts) {
		return 0, fmt.Errorf("the file has %d lines, so line %d is not in it", len(starts), at.Line+1)
	}
	start := starts[at.Line]
	end := len(text)
	if at.Line+1 < len(starts) {
		end = starts[at.Line+1] - 1
	}
	units := 0
	for offset := start; offset < end; {
		r, size := utf8.DecodeRune(text[offset:])
		if units >= at.Character {
			return offset, nil
		}
		units += len(utf16.Encode([]rune{r}))
		offset += size
	}
	return end, nil
}
