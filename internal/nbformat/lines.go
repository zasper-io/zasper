package nbformat

import (
	"strings"
	"unicode/utf8"
)

/*
The multiline strings, joined on the way in and split on the way out.

nbformat calls these "multiline strings": a field that may be one string or a list of lines that
mean the same text. Which fields they are is not a guess — it is what nbformat's own rwbase.py
rejoins and splits, and the two directions are deliberately not symmetrical.

Joined on the way in: a cell's `source`; every value of an attachment or output mime bundle that is
a list of strings and is not a JSON mime type; the `text` of any output that is not a mime bundle.

Split on the way out: a cell's `source`; only the *textual* members of a mime bundle, meaning
`text/*` plus javascript and svg; and only a `stream` output's `text`. Base64 image data is a mime
bundle value that is never split — one line of it is not a line of text, and splitting it would
rewrite every image in the file.
*/

// Mime types whose value is arbitrary JSON rather than text, so never joined or split.
func isJSONMime(mime string) bool {
	return mime == jsonMime ||
		(strings.HasPrefix(mime, "application/") && strings.HasSuffix(mime, "+json"))
}

const jsonMime = "application/json"

// splitMimes are the mime types whose value is split into lines on the way to disk: text of any
// kind, plus the two that are text without saying so in their name.
var splitMimes = map[string]bool{
	"application/javascript": true,
	"image/svg+xml":          true,
}

func isSplitMime(mime string) bool {
	return strings.HasPrefix(mime, "text/") || splitMimes[mime]
}

// joinDocument turns every multiline field into a single string, in place.
func joinDocument(doc Document) {
	for _, cell := range doc.Cells() {
		if lines, ok := sliceValue(cell["source"]); ok {
			cell["source"] = joinLines(lines)
		}

		if attachments, ok := mapValue(cell["attachments"]); ok {
			for _, bundle := range attachments {
				if fields, ok := mapValue(bundle); ok {
					joinBundle(fields)
				}
			}
		}

		if cellType, _ := stringValue(cell["cell_type"]); cellType != "code" {
			continue
		}
		outputs, _ := sliceValue(cell["outputs"])
		for _, entry := range outputs {
			output, ok := mapValue(entry)
			if !ok {
				continue
			}
			outputType, _ := stringValue(output["output_type"])
			switch outputType {
			case "execute_result", "display_data":
				if data, ok := mapValue(output["data"]); ok {
					joinBundle(data)
				}
			case "":
				// Nothing to do: an output with no type is not one this can interpret.
			default:
				if lines, ok := sliceValue(output["text"]); ok {
					output["text"] = joinLines(lines)
				}
			}
		}
	}
}

// splitDocument turns every multiline field back into a list of lines, in place.
func splitDocument(doc Document) {
	for _, cell := range doc.Cells() {
		if source, ok := stringValue(cell["source"]); ok {
			cell["source"] = toInterfaces(splitLines(source))
		}

		if attachments, ok := mapValue(cell["attachments"]); ok {
			for _, bundle := range attachments {
				if fields, ok := mapValue(bundle); ok {
					splitBundle(fields)
				}
			}
		}

		if cellType, _ := stringValue(cell["cell_type"]); cellType != "code" {
			continue
		}
		outputs, _ := sliceValue(cell["outputs"])
		for _, entry := range outputs {
			output, ok := mapValue(entry)
			if !ok {
				continue
			}
			outputType, _ := stringValue(output["output_type"])
			switch outputType {
			case "execute_result", "display_data":
				if data, ok := mapValue(output["data"]); ok {
					splitBundle(data)
				}
			case "stream":
				if text, ok := stringValue(output["text"]); ok {
					output["text"] = toInterfaces(splitLines(text))
				}
			}
		}
	}
}

// joinBundle joins every member of a mime bundle that was written as a list of lines.
func joinBundle(bundle map[string]interface{}) {
	for mime, value := range bundle {
		if isJSONMime(mime) {
			continue
		}
		if lines, ok := sliceValue(value); ok {
			bundle[mime] = joinLines(lines)
		}
	}
}

// splitBundle splits the members of a mime bundle that hold text, and only those.
func splitBundle(bundle map[string]interface{}) {
	for mime, value := range bundle {
		if !isSplitMime(mime) {
			continue
		}
		if text, ok := stringValue(value); ok {
			bundle[mime] = toInterfaces(splitLines(text))
		}
	}
}

/*
joinLines concatenates a list of lines. A member that is not a string means the field was never a
multiline string, so the list is left for the caller to hand back unchanged.
*/
func joinLines(lines []interface{}) interface{} {
	parts := make([]string, len(lines))
	for i, line := range lines {
		text, ok := stringValue(line)
		if !ok {
			return lines
		}
		parts[i] = text
	}
	return strings.Join(parts, "")
}

/*
splitLines splits text into lines, keeping the line endings, the way Python's
`str.splitlines(keepends=True)` does — which is the function nbformat splits with, so matching it is
what makes a file Zasper wrote and a file Jupyter wrote the same file.

Two details are easy to get wrong, and both were wrong here before: text ending in a newline does
not produce a trailing empty line, and the empty string produces no lines at all.
*/
func splitLines(text string) []string {
	lines := []string{}
	start := 0
	for offset := 0; offset < len(text); {
		symbol, width := utf8.DecodeRuneInString(text[offset:])
		if !isLineBreak(symbol) {
			offset += width
			continue
		}
		end := offset + width
		if symbol == '\r' && end < len(text) && text[end] == '\n' {
			end++
		}
		lines = append(lines, text[start:end])
		offset = end
		start = end
	}
	if start < len(text) {
		lines = append(lines, text[start:])
	}
	return lines
}

// lineBreaks holds the same boundaries as [isLineBreak], as a cutset.
const lineBreaks = "\n\v\f\r\x1c\x1d\x1e\u0085\u2028\u2029"

// splitLinesTrimmed splits text into lines and drops the line endings, the way Python's
// `str.splitlines()` does without keepends.
func splitLinesTrimmed(text string) []string {
	lines := splitLines(text)
	for index, line := range lines {
		lines[index] = strings.TrimRight(line, lineBreaks)
	}
	return lines
}

/*
isLineBreak reports the boundaries Python splits lines on. The exotic ones matter only for
byte-identical output on documents that contain them, but there is no reason to differ.
*/
func isLineBreak(symbol rune) bool {
	switch symbol {
	case '\n', '\v', '\f', '\r', 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029:
		return true
	}
	return false
}

func toInterfaces(values []string) []interface{} {
	out := make([]interface{}, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}
