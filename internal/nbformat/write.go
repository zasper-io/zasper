package nbformat

import (
	"bytes"
	"encoding/json"
	"fmt"
)

/*
clientOnlyCellKeys are keys the editor adds to a cell that are not part of the format and must not
reach the file. Unknown keys are otherwise preserved, so these have to be named.
*/
var clientOnlyCellKeys = []string{"reload"}

/*
Keys the format defines for a cell and for an output. A key in this set that appears where its type
does not allow it is removed on the way to disk — a markdown cell carrying `outputs`, say, which is
how the editor holds every cell in one shape. Keys that are not in these sets belong to whatever
wrote them and are left alone.
*/
var (
	codeOnlyCellKeys = []string{"execution_count", "outputs"}
	textOnlyCellKeys = []string{"attachments"}
	knownOutputKeys  = []string{"output_type", "name", "text", "data", "metadata", "execution_count", "ename", "evalue", "traceback"}
	outputKeysByType = map[string][]string{
		"stream":         {"output_type", "name", "text"},
		"execute_result": {"output_type", "data", "metadata", "execution_count"},
		"display_data":   {"output_type", "data", "metadata"},
		"error":          {"output_type", "ename", "evalue", "traceback"},
	}
)

/*
Marshal renders a document as a .ipynb file.

The bytes are what nbformat would write for the same document: keys in sorted order, indented by one
space, no HTML escaping, and a closing newline. That is not cosmetic — a save that reformats the
whole file makes every diff unreadable and every merge a conflict.
*/
func Marshal(doc Document) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	// Go escapes <, > and & by default, so `<b>42</b>` in an output would be written as
	// <b>42</b>. Nothing else writes notebooks that way.
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", " ")

	if err := encoder.Encode(Normalize(doc)); err != nil {
		return nil, fmt.Errorf("failed to marshal notebook: %w", err)
	}
	return buffer.Bytes(), nil
}

/*
Normalize returns the document in disk form: a copy with the multiline strings split into lines, the
cells and outputs carrying the keys their type allows and no others, and cell ids present exactly
when the document's version has them.

What it does not do is drop keys it does not recognise. A notebook is allowed to carry them, and the
point of the copy is that the caller's document is left as it was.

Normalizing a document that is already in disk form changes nothing, so a caller may normalize,
inspect the result — [Validate] reads either form — and hand that to [Marshal].
*/
func Normalize(doc Document) Document {
	out, _ := deepCopy(map[string]interface{}(doc)).(map[string]interface{})
	disk := Document(out)

	major, minor := disk.Version()
	if major == 0 {
		major, minor = Major, LatestMinor
	}
	disk["nbformat"] = json.Number(fmt.Sprint(major))
	disk["nbformat_minor"] = json.Number(fmt.Sprint(minor))
	if _, ok := mapValue(disk["metadata"]); !ok {
		disk["metadata"] = map[string]interface{}{}
	}
	if _, ok := sliceValue(disk["cells"]); !ok {
		disk["cells"] = []interface{}{}
	}

	taken := existingCellIDs(disk)
	for _, cell := range disk.Cells() {
		normalizeCell(cell, minor, taken)
	}

	stripTransient(disk)
	splitDocument(disk)
	return disk
}

func normalizeCell(cell map[string]interface{}, minor int, takenIDs map[string]bool) {
	for _, key := range clientOnlyCellKeys {
		delete(cell, key)
	}
	if _, ok := mapValue(cell["metadata"]); !ok {
		cell["metadata"] = map[string]interface{}{}
	}

	cellType, _ := stringValue(cell["cell_type"])
	if cellType == "code" {
		for _, key := range textOnlyCellKeys {
			delete(cell, key)
		}
		if _, ok := sliceValue(cell["outputs"]); !ok {
			cell["outputs"] = []interface{}{}
		}
		if _, ok := cell["execution_count"]; !ok {
			// Present and null, not absent: the format requires the key on a code cell, and null is
			// how it says the cell has not run.
			cell["execution_count"] = nil
		}
		outputs, _ := sliceValue(cell["outputs"])
		for _, entry := range outputs {
			if output, ok := mapValue(entry); ok {
				normalizeOutput(output)
			}
		}
	} else {
		for _, key := range codeOnlyCellKeys {
			delete(cell, key)
		}
		// Attachments arrived in 4.1, and an empty bundle says nothing that leaving the key out does
		// not say.
		if attachments, ok := mapValue(cell["attachments"]); ok && (len(attachments) == 0 || minor < 1) {
			delete(cell, "attachments")
		}
	}

	if minor >= 5 {
		if id, ok := stringValue(cell["id"]); !ok || id == "" {
			cell["id"] = uniqueCellID(takenIDs)
		}
	} else {
		// Cell ids arrived in 4.5. Writing one into an older document is exactly the kind of key
		// that makes a file fail validation against its own stated version.
		delete(cell, "id")
	}
}

func normalizeOutput(output map[string]interface{}) {
	outputType, _ := stringValue(output["output_type"])
	allowed, known := outputKeysByType[outputType]
	if !known {
		return
	}

	permitted := map[string]bool{}
	for _, key := range allowed {
		permitted[key] = true
	}
	for _, key := range knownOutputKeys {
		if !permitted[key] {
			delete(output, key)
		}
	}

	switch outputType {
	case "stream":
		if _, ok := stringValue(output["name"]); !ok {
			// The format requires a stream to say which stream it was. Every kernel sends it; a
			// document that does not is still better written with the common case than left invalid.
			output["name"] = "stdout"
		}
		if _, ok := output["text"]; !ok {
			output["text"] = ""
		}
	case "execute_result", "display_data":
		if _, ok := mapValue(output["data"]); !ok {
			output["data"] = map[string]interface{}{}
		}
		if _, ok := mapValue(output["metadata"]); !ok {
			output["metadata"] = map[string]interface{}{}
		}
		if outputType == "execute_result" {
			if _, ok := output["execution_count"]; !ok {
				output["execution_count"] = nil
			}
		}
	case "error":
		if _, ok := stringValue(output["ename"]); !ok {
			output["ename"] = ""
		}
		if _, ok := stringValue(output["evalue"]); !ok {
			output["evalue"] = ""
		}
		if _, ok := sliceValue(output["traceback"]); !ok {
			output["traceback"] = []interface{}{}
		}
	}
}

func existingCellIDs(doc Document) map[string]bool {
	taken := map[string]bool{}
	for _, cell := range doc.Cells() {
		if id, ok := stringValue(cell["id"]); ok && id != "" {
			taken[id] = true
		}
	}
	return taken
}

func uniqueCellID(taken map[string]bool) string {
	for {
		id := newCellID()
		if !taken[id] {
			taken[id] = true
			return id
		}
	}
}
