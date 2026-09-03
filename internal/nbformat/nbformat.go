/*
Package nbformat reads and writes Jupyter notebooks.

A notebook is held as a generic JSON document rather than a set of Go structs, because the format
is extensible by design: nbformat lets writers put arbitrary keys in notebook and cell metadata,
the standard keys vary in shape between minor versions, and a field a struct does not name is a
field a round trip silently drops. Only the parts this package has a reason to touch are
interpreted — the multiline strings, the cell and output shapes, and the version.

Two forms of the same document are in play, as in nbformat itself:

  - the disk form, where `source`, output `text` and mime-bundle values are lists of lines;
  - the wire form, where each of those is one string.

[Read] returns the wire form, which is what the editor consumes, and [Marshal] writes the disk
form. Everything else is carried through untouched.
*/
package nbformat

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// Major is the notebook format this package reads and writes. Older documents are converted to it
// on the way in (see [Read]); there is no support for writing them back out.
const Major = 4

// LatestMinor is the newest 4.x revision this package knows: 4.5, the one that gave cells an `id`.
const LatestMinor = 5

/*
Document is a notebook. It is the decoded JSON, so every key the file carried is still in it,
including keys this package does not know about.

The zero value is not a notebook; use [Read], or build one and hand it to [Marshal].
*/
type Document map[string]interface{}

// New returns an empty notebook at the newest version of the format, which is what a new notebook
// created by Jupyter is.
func New() Document {
	return Document{
		"cells":          []interface{}{},
		"metadata":       map[string]interface{}{},
		"nbformat":       Major,
		"nbformat_minor": LatestMinor,
	}
}

// Version reports the document's nbformat version, or 0, 0 when it does not state one.
func (d Document) Version() (major int, minor int) {
	major, _ = intValue(d["nbformat"])
	minor, _ = intValue(d["nbformat_minor"])
	return major, minor
}

// Cells returns the document's cells. The maps are the document's own, not copies, so writing to
// one writes to the document.
func (d Document) Cells() []map[string]interface{} {
	raw, _ := d["cells"].([]interface{})
	cells := make([]map[string]interface{}, 0, len(raw))
	for _, entry := range raw {
		if cell, ok := entry.(map[string]interface{}); ok {
			cells = append(cells, cell)
		}
	}
	return cells
}

// Metadata returns the notebook-level metadata, or nil when there is none.
func (d Document) Metadata() map[string]interface{} {
	metadata, _ := d["metadata"].(map[string]interface{})
	return metadata
}

// intValue reads a JSON number as an int. Numbers decode as [json.Number] here (see [Read]), which
// keeps the file's own spelling, so this is the only place that has to interpret one.
func intValue(value interface{}) (int, bool) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := typed.Int64()
		if err != nil {
			return 0, false
		}
		return int(parsed), true
	case float64:
		return int(typed), true
	case int:
		return typed, true
	}
	return 0, false
}

func mapValue(value interface{}) (map[string]interface{}, bool) {
	typed, ok := value.(map[string]interface{})
	return typed, ok
}

func sliceValue(value interface{}) ([]interface{}, bool) {
	typed, ok := value.([]interface{})
	return typed, ok
}

func stringValue(value interface{}) (string, bool) {
	typed, ok := value.(string)
	return typed, ok
}

/*
transientMetadataKeys are notebook metadata keys that describe the session rather than the notebook.
nbformat drops them when reading *and* when writing, so they never reach a file; dropping them in
both directions here is what keeps a file Zasper saved identical to the one Jupyter would save.

`orig_nbformat` records the version an upgraded notebook came from, and `signature` is a hash from a
trust mechanism that predates the current one.
*/
var transientMetadataKeys = []string{"orig_nbformat", "orig_nbformat_minor", "signature"}

// stripTransient removes the transient keys from the document and its cells, in place.
func stripTransient(doc Document) {
	if metadata := doc.Metadata(); metadata != nil {
		for _, key := range transientMetadataKeys {
			delete(metadata, key)
		}
	}
	for _, cell := range doc.Cells() {
		if metadata, ok := mapValue(cell["metadata"]); ok {
			// Whether a cell may run the code in its outputs is decided per session, by whoever is
			// running it, not by the file.
			delete(metadata, "trusted")
		}
	}
}

/*
newCellID returns an id for a cell that has none.

nbformat generates eight hex characters, and the schema asks only for 1 to 64 characters of
`[a-zA-Z0-9-_]`. Collisions are checked by the caller, which knows the ids already in the document.
*/
func newCellID() string {
	buf := make([]byte, 4)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand does not fail in practice; a panic here would be worse than a fixed id that
		// the caller's uniqueness check will reject and retry.
		return "00000000"
	}
	return hex.EncodeToString(buf)
}

// deepCopy copies a decoded JSON value, so normalising a document for the disk cannot write
// through to the one the caller still holds.
func deepCopy(value interface{}) interface{} {
	switch typed := value.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(typed))
		for key, entry := range typed {
			out[key] = deepCopy(entry)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(typed))
		for i, entry := range typed {
			out[i] = deepCopy(entry)
		}
		return out
	default:
		return typed
	}
}

func versionString(major, minor int) string {
	return fmt.Sprintf("%d.%d", major, minor)
}
