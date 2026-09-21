package search

import (
	"regexp"
	"strings"

	"github.com/zasper-io/zasper/internal/nbformat"
)

/*
A notebook is searched as its cells: on disk it is JSON, and a match in a quoted,
escaped line of it is neither what the reader sees nor something a replace can safely write into. Sources
are searched and can be replaced; what a cell printed is searched and never replaced, as in the notebook's
own find.
*/

// Colour and cursor codes in a traceback, which the output area draws as colour and a search should not see.
var terminalCodes = regexp.MustCompile("\x1b\\[[0-9;]*[A-Za-z]")

func (r *run) notebookMatches(relative string, data []byte) *FileMatches {
	doc, err := nbformat.Read(data)
	if err != nil {
		return nil
	}
	lines := []LineMatch{}
	for index, cell := range doc.Cells() {
		for _, match := range r.textMatches(joined(cell["source"])) {
			match.Cell = &index
			lines = append(lines, match)
		}
		for _, match := range r.textMatches(outputText(cell)) {
			match.Cell = &index
			match.Output = true
			lines = append(lines, match)
		}
	}
	if len(lines) == 0 {
		return nil
	}
	return &FileMatches{Path: relative, Kind: "notebook", Lines: lines}
}

// outputText is a cell's outputs as text: a stream, plain text, and an error with its traceback.
func outputText(cell map[string]interface{}) string {
	outputs, _ := cell["outputs"].([]interface{})
	parts := []string{}
	for _, raw := range outputs {
		output, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		pieces := []string{}
		if text := joined(output["text"]); text != "" {
			pieces = append(pieces, text)
		}
		if bundle, ok := output["data"].(map[string]interface{}); ok {
			if plain := joined(bundle["text/plain"]); plain != "" {
				pieces = append(pieces, plain)
			}
		}
		if name, ok := output["ename"].(string); ok {
			value, _ := output["evalue"].(string)
			pieces = append(pieces, name+": "+value)
		}
		if traceback, ok := output["traceback"].([]interface{}); ok {
			pieces = append(pieces, terminalCodes.ReplaceAllString(joinedLines(traceback, "\n"), ""))
		}
		if len(pieces) > 0 {
			parts = append(parts, strings.Join(pieces, "\n"))
		}
	}
	return strings.Join(parts, "\n")
}

// joined reads a string that the format allows to be written as a list of lines.
func joined(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case []interface{}:
		return joinedLines(v, "")
	}
	return ""
}

func joinedLines(lines []interface{}, separator string) string {
	parts := make([]string, 0, len(lines))
	for _, line := range lines {
		if text, ok := line.(string); ok {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, separator)
}
