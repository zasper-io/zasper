package nbformat

import (
	"encoding/json"
	"fmt"
	"strings"
)

/*
Conversion of pre-4 notebooks, which is the only way to read one: a v3 document keeps its cells
under `worksheets`, so to a reader that knows only version 4 it is a notebook with no cells at all.

What the mapping does is not invented here — it is what nbformat's own v3-to-v4 conversion does, so
that a notebook upgraded by Zasper and the same notebook upgraded by Jupyter come out the same:

	worksheets[*].cells  -> cells, in order
	cell.input           -> cell.source          (code cells)
	cell.prompt_number   -> cell.execution_count (code cells)
	cell.collapsed       -> cell.metadata.collapsed (code cells)
	cell.language        -> dropped, the notebook's metadata says the language
	heading cells        -> markdown, the level as leading '#'s and the text on one line
	html cells           -> markdown
	output pyout         -> execute_result, prompt_number -> execution_count
	output pyerr         -> error
	output.stream        -> output.name
	output.png, .html …  -> output.data, keyed by mime type
	metadata.name        -> dropped, version 4 has no notebook name
	orig_nbformat, orig_nbformat_minor -> dropped (see [stripTransient])

The result is 4.5, the newest revision, which is also what nbformat produces.

Version 2 goes through the same mapping. The one thing nbformat does differently for it is decode
byte strings, which a notebook read from JSON cannot contain.
*/

// v3MimeKeys maps the sibling keys a pre-4 output carried to the mime bundle that replaced them.
var v3MimeKeys = map[string]string{
	"text":       "text/plain",
	"html":       "text/html",
	"svg":        "image/svg+xml",
	"png":        "image/png",
	"jpeg":       "image/jpeg",
	"latex":      "text/latex",
	"json":       jsonMime,
	"javascript": "application/javascript",
}

/*
Convert upgrades a pre-4 document to 4.5 in place. Versions 2 and 3 are supported, which is every
version that stores cells under `worksheets`; version 1 predates that and is not.
*/
func Convert(doc Document) error {
	major, minor := doc.Version()
	if major >= Major {
		return nil
	}
	if major < 2 {
		return fmt.Errorf(
			"notebook format %s is too old to read; versions 2, 3 and 4.x are supported",
			versionString(major, minor))
	}

	cells := []interface{}{}
	// The result is 4.5, where every cell has an id, and a cell from a version that had none needs
	// one now.
	takenIDs := map[string]bool{}
	worksheets, _ := sliceValue(doc["worksheets"])
	for _, entry := range worksheets {
		worksheet, ok := mapValue(entry)
		if !ok {
			continue
		}
		sheetCells, _ := sliceValue(worksheet["cells"])
		for _, cellEntry := range sheetCells {
			cell, ok := mapValue(cellEntry)
			if !ok {
				continue
			}
			upgraded := upgradeCell(cell)
			upgraded["id"] = uniqueCellID(takenIDs)
			cells = append(cells, upgraded)
		}
	}

	metadata := doc.Metadata()
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	// Version 4 has no notebook name; the file name is the name.
	delete(metadata, "name")

	delete(doc, "worksheets")
	// Version 2 recorded the version it came from at the top level. nbformat moves it into the
	// metadata, from where its own reader and writer both delete it again, so it goes here.
	delete(doc, "orig_nbformat")
	delete(doc, "orig_nbformat_minor")
	doc["cells"] = cells
	doc["metadata"] = metadata
	doc["nbformat"] = json.Number(fmt.Sprint(Major))
	doc["nbformat_minor"] = json.Number(fmt.Sprint(LatestMinor))
	return nil
}

func upgradeCell(cell map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	for key, value := range cell {
		out[key] = value
	}

	metadata, ok := mapValue(out["metadata"])
	if !ok {
		metadata = map[string]interface{}{}
	}
	out["metadata"] = metadata

	cellType, _ := stringValue(out["cell_type"])
	switch cellType {
	case "code":
		delete(out, "language")
		// A display hint that version 4 keeps in the cell's metadata rather than on the cell.
		if collapsed, ok := out["collapsed"]; ok {
			metadata["collapsed"] = collapsed
			delete(out, "collapsed")
		}

		out["source"] = ""
		if input, ok := out["input"]; ok {
			out["source"] = input
		}
		delete(out, "input")

		out["execution_count"] = nil
		if prompt, ok := out["prompt_number"]; ok {
			out["execution_count"] = prompt
		}
		delete(out, "prompt_number")

		outputs, _ := sliceValue(out["outputs"])
		upgraded := make([]interface{}, 0, len(outputs))
		for _, entry := range outputs {
			output, ok := mapValue(entry)
			if !ok {
				continue
			}
			upgraded = append(upgraded, upgradeOutput(output))
		}
		out["outputs"] = upgraded

	case "heading":
		// Version 4 has no heading cell; the level becomes markdown's own heading syntax. A heading
		// that spanned lines becomes one line, because '#' only makes a heading of the line it opens.
		level, ok := intValue(out["level"])
		if !ok || level < 1 {
			level = 1
		}
		source, _ := stringValue(out["source"])
		if lines, isList := sliceValue(out["source"]); isList {
			if joined, isText := joinLines(lines).(string); isText {
				source = joined
			}
		}
		out["cell_type"] = "markdown"
		out["source"] = strings.Repeat("#", level) + " " + strings.Join(splitLinesTrimmed(source), " ")
		delete(out, "level")

	case "html":
		// Version 2's html cell, which nbformat's own comment says will never be met in practice.
		out["cell_type"] = "markdown"
	}

	return out
}

func upgradeOutput(output map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	for key, value := range output {
		out[key] = value
	}

	outputType, _ := stringValue(out["output_type"])
	switch outputType {
	case "pyout":
		out["output_type"] = "execute_result"
	case "pyerr":
		out["output_type"] = "error"
	}
	outputType, _ = stringValue(out["output_type"])

	if prompt, ok := out["prompt_number"]; ok {
		out["execution_count"] = prompt
	}
	delete(out, "prompt_number")

	if stream, ok := out["stream"]; ok {
		out["name"] = stream
	}
	delete(out, "stream")

	switch outputType {
	case "execute_result", "display_data":
		data, ok := mapValue(out["data"])
		if !ok {
			data = map[string]interface{}{}
		}
		for key, mime := range v3MimeKeys {
			if value, ok := out[key]; ok {
				data[mime] = value
				delete(out, key)
			}
		}
		out["data"] = data
		if _, ok := mapValue(out["metadata"]); !ok {
			out["metadata"] = map[string]interface{}{}
		}
	default:
		// stream and error keep their own fields; only the mime-keyed ones are a version 4 idea.
		for key := range v3MimeKeys {
			if key == "text" {
				continue
			}
			delete(out, key)
		}
	}

	return out
}
