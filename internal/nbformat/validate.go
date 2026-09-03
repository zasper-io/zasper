package nbformat

import (
	"fmt"
	"regexp"
)

/*
Validate checks a document against the rules of nbformat 4, and returns everything it finds rather
than the first thing. It accepts either form of the document — a multiline field may be one string
or a list of lines — so it can be used on a file just read and on a document about to be written.

The rules are the ones nbformat's JSON schema states, encoded by hand:

  - a cell is an object with a known `cell_type`, a `source` and a `metadata` object;
  - `execution_count` and `outputs` belong to code cells and nowhere else;
  - `attachments` belong to markdown and raw cells, from 4.1 onwards, and never to a code cell;
  - a cell has an `id` from 4.5 onwards, and no `id` before it: 1 to 64 characters of
    [a-zA-Z0-9-_], unique within the notebook;
  - each output type carries its own required fields.

A Problem is worth reporting but not worth refusing to open the file for. The exception is a field
whose JSON type leaves nothing to read at all — `cells` that is a number, say — which is marked
Fatal, because carrying on would mean handing back a notebook whose content was silently dropped.
*/
func Validate(doc Document) []Problem {
	problems := []Problem{}
	report := func(path, message string) {
		problems = append(problems, Problem{Path: path, Message: message})
	}
	fatal := func(path, message string) {
		problems = append(problems, Problem{Path: path, Message: message, Fatal: true})
	}

	major, minor := doc.Version()
	if _, ok := intValue(doc["nbformat"]); !ok {
		report("nbformat", "missing or not a number")
	}
	if _, ok := intValue(doc["nbformat_minor"]); !ok {
		report("nbformat_minor", "missing or not a number")
	}
	if major != 0 && major != Major {
		report("nbformat", fmt.Sprintf("version %s, not %d.x", versionString(major, minor), Major))
	}
	if _, ok := mapValue(doc["metadata"]); !ok {
		if _, present := doc["metadata"]; present {
			fatal("metadata", "not an object")
		} else {
			report("metadata", "missing")
		}
	}

	rawCells, ok := sliceValue(doc["cells"])
	if !ok {
		if _, present := doc["cells"]; present {
			fatal("cells", "not a list")
		} else {
			report("cells", "missing")
		}
		return problems
	}

	seenIDs := map[string]int{}
	for index, entry := range rawCells {
		path := fmt.Sprintf("cells[%d]", index)
		cell, ok := mapValue(entry)
		if !ok {
			fatal(path, "not an object")
			continue
		}
		problems = append(problems, validateCell(cell, path, minor, seenIDs)...)
	}
	return problems
}

// Problem is one way a document departs from the format.
type Problem struct {
	// Path locates it, as `cells[2].outputs[0].data`.
	Path    string
	Message string
	// Fatal marks a problem that makes the document unreadable rather than merely wrong.
	Fatal bool
}

func (p Problem) Error() string {
	return fmt.Sprintf("%s: %s", p.Path, p.Message)
}

// cellIDPattern is the schema's own pattern for a cell id.
var cellIDPattern = regexp.MustCompile(`^[a-zA-Z0-9-_]+$`)

var knownCellTypes = map[string]bool{"code": true, "markdown": true, "raw": true}

func validateCell(cell map[string]interface{}, path string, minor int, seenIDs map[string]int) []Problem {
	problems := []Problem{}
	report := func(field, message string) {
		problems = append(problems, Problem{Path: path + field, Message: message})
	}

	cellType, ok := stringValue(cell["cell_type"])
	if !ok {
		report(".cell_type", "missing")
	} else if !knownCellTypes[cellType] {
		report(".cell_type", fmt.Sprintf("unknown cell type %q", cellType))
	}
	if !isMultiline(cell["source"]) {
		report(".source", "missing, or not a string or list of strings")
	}
	if _, ok := mapValue(cell["metadata"]); !ok {
		report(".metadata", "missing or not an object")
	}

	problems = append(problems, validateCellID(cell, path, minor, seenIDs)...)

	if cellType == "code" {
		if _, present := cell["execution_count"]; !present {
			report(".execution_count", "missing on a code cell")
		} else if !isCount(cell["execution_count"]) {
			report(".execution_count", "not a number or null")
		}
		outputs, ok := sliceValue(cell["outputs"])
		if !ok {
			report(".outputs", "missing or not a list on a code cell")
		}
		for index, entry := range outputs {
			outputPath := fmt.Sprintf("%s.outputs[%d]", path, index)
			output, ok := mapValue(entry)
			if !ok {
				problems = append(problems, Problem{Path: outputPath, Message: "not an object"})
				continue
			}
			problems = append(problems, validateOutput(output, outputPath)...)
		}
		if _, present := cell["attachments"]; present {
			report(".attachments", "not allowed on a code cell")
		}
	} else {
		if _, present := cell["execution_count"]; present {
			report(".execution_count", "only allowed on a code cell")
		}
		if _, present := cell["outputs"]; present {
			report(".outputs", "only allowed on a code cell")
		}
		if attachments, present := cell["attachments"]; present {
			if minor < 1 {
				report(".attachments", fmt.Sprintf("not allowed before 4.1 (this notebook is 4.%d)", minor))
			}
			problems = append(problems, validateAttachments(attachments, path+".attachments")...)
		}
	}
	return problems
}

func validateCellID(cell map[string]interface{}, path string, minor int, seenIDs map[string]int) []Problem {
	problems := []Problem{}
	report := func(message string) {
		problems = append(problems, Problem{Path: path + ".id", Message: message})
	}

	id, isText := stringValue(cell["id"])
	_, present := cell["id"]
	switch {
	case minor < 5:
		if present {
			report(fmt.Sprintf("cell ids arrived in 4.5; this notebook is 4.%d", minor))
		}
		return problems
	case !present:
		report("missing; required from 4.5 onwards")
		return problems
	case !isText:
		report("not a string")
		return problems
	}

	if length := len([]rune(id)); length < 1 || length > 64 {
		report(fmt.Sprintf("%d characters long; must be 1 to 64", length))
	}
	if !cellIDPattern.MatchString(id) {
		report(fmt.Sprintf("%q contains characters other than letters, digits, - and _", id))
	}
	if first, seen := seenIDs[id]; seen {
		report(fmt.Sprintf("%q is already the id of cells[%d]", id, first))
	} else {
		seenIDs[id] = cellIndex(path)
	}
	return problems
}

// requiredOutputFields lists what each output type must carry, beyond `output_type` itself.
var requiredOutputFields = map[string][]string{
	"stream":         {"name", "text"},
	"execute_result": {"data", "metadata", "execution_count"},
	"display_data":   {"data", "metadata"},
	"error":          {"ename", "evalue", "traceback"},
}

func validateOutput(output map[string]interface{}, path string) []Problem {
	problems := []Problem{}
	report := func(field, message string) {
		problems = append(problems, Problem{Path: path + field, Message: message})
	}

	outputType, ok := stringValue(output["output_type"])
	if !ok {
		report(".output_type", "missing")
		return problems
	}
	required, known := requiredOutputFields[outputType]
	if !known {
		report(".output_type", fmt.Sprintf("unknown output type %q", outputType))
		return problems
	}
	for _, field := range required {
		if _, present := output[field]; !present {
			report("."+field, fmt.Sprintf("missing on a %s output", outputType))
		}
	}

	switch outputType {
	case "stream":
		if name, ok := stringValue(output["name"]); ok && name != "stdout" && name != "stderr" {
			report(".name", fmt.Sprintf("%q is neither stdout nor stderr", name))
		}
		if _, present := output["text"]; present && !isMultiline(output["text"]) {
			report(".text", "not a string or list of strings")
		}
	case "execute_result", "display_data":
		if data, present := output["data"]; present {
			problems = append(problems, validateBundle(data, path+".data", true)...)
		}
		if metadata, present := output["metadata"]; present {
			if _, ok := mapValue(metadata); !ok {
				report(".metadata", "not an object")
			}
		}
		if count, present := output["execution_count"]; present && !isCount(count) {
			report(".execution_count", "not a number or null")
		}
	case "error":
		if traceback, present := output["traceback"]; present {
			lines, ok := sliceValue(traceback)
			if !ok {
				// Unlike output text, a traceback is a genuine list of frames, not a split-up string.
				report(".traceback", "not a list")
			}
			for _, line := range lines {
				if _, ok := stringValue(line); !ok {
					report(".traceback", "contains something that is not a string")
					break
				}
			}
		}
	}
	return problems
}

func validateAttachments(attachments interface{}, path string) []Problem {
	bundles, ok := mapValue(attachments)
	if !ok {
		return []Problem{{Path: path, Message: "not an object"}}
	}
	problems := []Problem{}
	for name, bundle := range bundles {
		problems = append(problems, validateBundle(bundle, fmt.Sprintf("%s[%q]", path, name), false)...)
	}
	return problems
}

// validateBundle checks a mime bundle: mime type to content. `skipJSON` leaves application/json
// alone, whose value is arbitrary JSON rather than text.
func validateBundle(bundle interface{}, path string, skipJSON bool) []Problem {
	fields, ok := mapValue(bundle)
	if !ok {
		return []Problem{{Path: path, Message: "not an object"}}
	}
	problems := []Problem{}
	for mime, value := range fields {
		if skipJSON && mime == jsonMime {
			continue
		}
		if !isMultiline(value) {
			problems = append(problems, Problem{
				Path:    fmt.Sprintf("%s[%q]", path, mime),
				Message: "not a string or list of strings",
			})
		}
	}
	return problems
}

// isMultiline reports whether a value is one of the two shapes a multiline string is allowed to
// take (see lines.go).
func isMultiline(value interface{}) bool {
	if _, ok := stringValue(value); ok {
		return true
	}
	lines, ok := sliceValue(value)
	if !ok {
		return false
	}
	for _, line := range lines {
		if _, ok := stringValue(line); !ok {
			return false
		}
	}
	return true
}

// isCount reports whether a value can be an execution count: a number, or null for "has not run".
func isCount(value interface{}) bool {
	if value == nil {
		return true
	}
	_, ok := intValue(value)
	return ok
}

// cellIndex reads the index back out of a path like `cells[2]`, so a duplicate id can name the cell
// that had it first.
func cellIndex(path string) int {
	index := 0
	if _, err := fmt.Sscanf(path, "cells[%d]", &index); err != nil {
		return -1
	}
	return index
}
