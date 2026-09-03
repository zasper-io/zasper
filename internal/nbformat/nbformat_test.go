package nbformat

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

// The fixtures in testdata are written by nbformat itself, one per version, each with a code cell
// carrying all four output types, a markdown cell with an attachment and a raw cell. See
// make_fixtures.py in the same directory.
var v4Fixtures = []string{"v4.0", "v4.1", "v4.2", "v4.3", "v4.4", "v4.5"}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name+".ipynb"))
	if err != nil {
		t.Fatalf("failed to read fixture %s: %v", name, err)
	}
	return data
}

/*
The acceptance test for the whole package: a notebook read and written again is the same file, byte
for byte, for every version of the format. Anything that gets dropped, reformatted or relabelled
shows up here as a diff.
*/
func TestRoundTripIsByteIdentical(t *testing.T) {
	for _, name := range v4Fixtures {
		t.Run(name, func(t *testing.T) {
			original := readFixture(t, name)

			doc, err := Read(original)
			if err != nil {
				t.Fatalf("Read failed: %v", err)
			}
			written, err := Marshal(doc)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}

			if string(written) != string(original) {
				t.Errorf("round trip changed the file.\n--- want ---\n%s\n--- got ---\n%s", original, written)
			}
		})
	}
}

/*
Normalizing what is already in disk form changes nothing, which is what lets the save path normalize
once, check the result and hand that to Marshal — Marshal normalizes again, and a second pass that
split the lines of an already-split source would rewrite every cell in the file.
*/
func TestNormalizeIsIdempotent(t *testing.T) {
	for _, name := range append(v4Fixtures, "v3") {
		t.Run(name, func(t *testing.T) {
			doc, err := Read(readFixture(t, name))
			if err != nil {
				t.Fatalf("Read failed: %v", err)
			}

			once := Normalize(doc)
			twice := Normalize(once)

			if !reflect.DeepEqual(map[string]interface{}(once), map[string]interface{}(twice)) {
				t.Errorf("normalizing twice differs from normalizing once:\n%#v\n%#v", once, twice)
			}
		})
	}
}

func TestFixturesValidateClean(t *testing.T) {
	for _, name := range v4Fixtures {
		t.Run(name, func(t *testing.T) {
			doc, err := Read(readFixture(t, name))
			if err != nil {
				t.Fatalf("Read failed: %v", err)
			}
			if problems := Validate(doc); len(problems) > 0 {
				t.Errorf("valid fixture reported problems: %v", problems)
			}
		})
	}
}

func TestReadJoinsMultilineStrings(t *testing.T) {
	doc, err := Read(readFixture(t, "v4.5"))
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}

	cells := doc.Cells()
	if len(cells) != 3 {
		t.Fatalf("expected 3 cells, got %d", len(cells))
	}

	if source, _ := stringValue(cells[0]["source"]); source != "print('one')\nprint('two')" {
		t.Errorf("cell source not joined into one string: %#v", cells[0]["source"])
	}

	outputs, _ := sliceValue(cells[0]["outputs"])
	stream, _ := mapValue(outputs[0])
	if text, _ := stringValue(stream["text"]); text != "one\ntwo\n" {
		t.Errorf("stream text not joined: %#v", stream["text"])
	}

	result, _ := mapValue(outputs[1])
	data, _ := mapValue(result["data"])
	if html, _ := stringValue(data["text/html"]); html != "<b>42</b>" {
		t.Errorf("mime bundle value not joined: %#v", data["text/html"])
	}

	// A traceback is a list of frames, not a split-up string, so it stays a list.
	failure, _ := mapValue(outputs[2])
	traceback, ok := sliceValue(failure["traceback"])
	if !ok || len(traceback) != 2 {
		t.Errorf("traceback should stay a list of frames, got %#v", failure["traceback"])
	}

	attachments, _ := mapValue(cells[1]["attachments"])
	pixel, _ := mapValue(attachments["pixel.png"])
	if png, _ := stringValue(pixel["image/png"]); !strings.HasPrefix(png, "iVBORw0KGgo") {
		t.Errorf("attachment not carried through as text: %#v", pixel["image/png"])
	}
}

// Reading a notebook that is already in wire form, which is what the editor sends back on save.
func TestUnmarshalLeavesLinesAlone(t *testing.T) {
	doc, err := Unmarshal([]byte(`{
		"cells": [{"cell_type": "markdown", "metadata": {}, "source": "a\nb\n"}],
		"metadata": {}, "nbformat": 4, "nbformat_minor": 4
	}`))
	if err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	if source, _ := stringValue(doc.Cells()[0]["source"]); source != "a\nb\n" {
		t.Errorf("source changed: %#v", doc.Cells()[0]["source"])
	}
}

func TestMarshalKeepsTheDocumentsOwnVersion(t *testing.T) {
	for _, name := range v4Fixtures {
		t.Run(name, func(t *testing.T) {
			doc, err := Read(readFixture(t, name))
			if err != nil {
				t.Fatalf("Read failed: %v", err)
			}
			major, minor := doc.Version()
			written, err := Marshal(doc)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}
			reread, err := Read(written)
			if err != nil {
				t.Fatalf("Read of written file failed: %v", err)
			}
			gotMajor, gotMinor := reread.Version()
			if gotMajor != major || gotMinor != minor {
				t.Errorf("version %s became %s", versionString(major, minor), versionString(gotMajor, gotMinor))
			}

			_, hasID := reread.Cells()[0]["id"]
			if wantID := minor >= 5; hasID != wantID {
				t.Errorf("cell id present = %v in a 4.%d notebook, want %v", hasID, minor, wantID)
			}
		})
	}
}

func TestMarshalDoesNotChangeTheCallersDocument(t *testing.T) {
	doc, err := Read(readFixture(t, "v4.5"))
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	if _, err := Marshal(doc); err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	if source, _ := stringValue(doc.Cells()[0]["source"]); source != "print('one')\nprint('two')" {
		t.Errorf("Marshal wrote through to the caller's document: %#v", doc.Cells()[0]["source"])
	}
}

// The format is extensible, and a key this package does not know about is a key some other tool
// does.
func TestMarshalKeepsUnknownKeys(t *testing.T) {
	doc, err := Unmarshal([]byte(`{
		"cells": [{
			"cell_type": "code", "execution_count": null, "outputs": [], "source": "",
			"metadata": {"deathstar": {"plans": true}}, "invented_by_some_other_tool": 7
		}],
		"metadata": {"an_extension": {"kept": "yes"}},
		"nbformat": 4, "nbformat_minor": 4,
		"an_unknown_top_level_key": ["also kept"]
	}`))
	if err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	written, err := Marshal(doc)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	for _, kept := range []string{"an_unknown_top_level_key", "an_extension", "deathstar", "invented_by_some_other_tool"} {
		if !strings.Contains(string(written), kept) {
			t.Errorf("%q was dropped on write:\n%s", kept, written)
		}
	}
}

/*
The editor holds every cell in one shape, so a markdown cell reaches the writer carrying the keys a
code cell has. Those belong to a code cell and nowhere else, and writing them produces a file
Jupyter rejects.
*/
func TestNormalizeRemovesMisplacedKeys(t *testing.T) {
	doc := Document{
		"nbformat": 4, "nbformat_minor": 5, "metadata": map[string]interface{}{},
		"cells": []interface{}{
			map[string]interface{}{
				"cell_type": "markdown", "id": "aaaa1111", "source": "text", "metadata": map[string]interface{}{},
				"execution_count": nil, "outputs": []interface{}{}, "attachments": map[string]interface{}{},
				"reload": true,
			},
			map[string]interface{}{
				"cell_type": "code", "id": "bbbb2222", "source": "1", "metadata": map[string]interface{}{},
				"attachments": map[string]interface{}{"pixel.png": map[string]interface{}{}},
				"reload":      false,
			},
		},
	}

	disk := Normalize(doc)
	markdown, code := disk.Cells()[0], disk.Cells()[1]

	for _, key := range []string{"execution_count", "outputs", "attachments", "reload"} {
		if _, present := markdown[key]; present {
			t.Errorf("markdown cell kept %q", key)
		}
	}
	for _, key := range []string{"attachments", "reload"} {
		if _, present := code[key]; present {
			t.Errorf("code cell kept %q", key)
		}
	}
	if count, present := code["execution_count"]; !present || count != nil {
		t.Errorf("code cell execution_count = %#v, want present and null", count)
	}
	if outputs, ok := sliceValue(code["outputs"]); !ok || len(outputs) != 0 {
		t.Errorf("code cell outputs = %#v, want an empty list", code["outputs"])
	}
	if problems := Validate(disk); len(problems) > 0 {
		t.Errorf("normalized document still has problems: %v", problems)
	}
}

func TestNormalizeGivesEveryCellAnID(t *testing.T) {
	doc := Document{
		"nbformat": 4, "nbformat_minor": 5, "metadata": map[string]interface{}{},
		"cells": []interface{}{
			map[string]interface{}{"cell_type": "markdown", "source": "a", "metadata": map[string]interface{}{}},
			map[string]interface{}{"cell_type": "markdown", "source": "b", "metadata": map[string]interface{}{}, "id": "kept-id"},
			map[string]interface{}{"cell_type": "markdown", "source": "c", "metadata": map[string]interface{}{}, "id": ""},
		},
	}

	cells := Normalize(doc).Cells()
	seen := map[string]bool{}
	for index, cell := range cells {
		id, ok := stringValue(cell["id"])
		if !ok || id == "" {
			t.Fatalf("cell %d has no id", index)
		}
		if !cellIDPattern.MatchString(id) {
			t.Errorf("cell %d id %q does not match the schema's pattern", index, id)
		}
		if seen[id] {
			t.Errorf("cell %d reuses id %q", index, id)
		}
		seen[id] = true
	}
	if id, _ := stringValue(cells[1]["id"]); id != "kept-id" {
		t.Errorf("an existing id was replaced: %q", id)
	}
}

func TestNormalizeFillsInRequiredOutputFields(t *testing.T) {
	doc := Document{
		"nbformat": 4, "nbformat_minor": 5, "metadata": map[string]interface{}{},
		"cells": []interface{}{map[string]interface{}{
			"cell_type": "code", "id": "aaaa1111", "source": "1", "metadata": map[string]interface{}{},
			"execution_count": nil,
			"outputs": []interface{}{
				map[string]interface{}{"output_type": "stream", "text": "hello"},
				map[string]interface{}{"output_type": "execute_result", "data": map[string]interface{}{"text/plain": "1"}},
				map[string]interface{}{"output_type": "error", "ename": "ValueError"},
				// A type this package does not know is left exactly as it is.
				map[string]interface{}{"output_type": "from_the_future", "payload": "kept"},
			},
		}},
	}

	outputs, _ := sliceValue(Normalize(doc).Cells()[0]["outputs"])
	stream, _ := mapValue(outputs[0])
	if name, _ := stringValue(stream["name"]); name != "stdout" {
		t.Errorf("stream name = %#v, want stdout", stream["name"])
	}
	result, _ := mapValue(outputs[1])
	if _, ok := mapValue(result["metadata"]); !ok {
		t.Errorf("execute_result metadata = %#v, want an object", result["metadata"])
	}
	if count, present := result["execution_count"]; !present || count != nil {
		t.Errorf("execute_result execution_count = %#v, want present and null", count)
	}
	failure, _ := mapValue(outputs[2])
	if traceback, ok := sliceValue(failure["traceback"]); !ok || len(traceback) != 0 {
		t.Errorf("error traceback = %#v, want an empty list", failure["traceback"])
	}
	future, _ := mapValue(outputs[3])
	if !reflect.DeepEqual(future, map[string]interface{}{"output_type": "from_the_future", "payload": "kept"}) {
		t.Errorf("an unknown output type was rewritten: %#v", future)
	}
}

/*
Jupyter's own byte format: sorted keys, one space of indent, a trailing newline and no HTML escaping.
Go's encoder escapes <, > and & unless told not to, which would turn every HTML output into
<-soup and make the file differ from the one Jupyter writes.
*/
func TestMarshalWritesJupytersByteFormat(t *testing.T) {
	doc := Document{
		"nbformat": 4, "nbformat_minor": 4, "metadata": map[string]interface{}{},
		"cells": []interface{}{map[string]interface{}{
			"cell_type": "code", "source": "x", "metadata": map[string]interface{}{}, "execution_count": nil,
			"outputs": []interface{}{map[string]interface{}{
				"output_type": "display_data", "metadata": map[string]interface{}{},
				"data": map[string]interface{}{"text/html": "<b>a & b</b>"},
			}},
		}},
	}

	written, err := Marshal(doc)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	text := string(written)

	if !strings.Contains(text, `"<b>a & b</b>"`) {
		t.Errorf("HTML was escaped:\n%s", text)
	}
	if !strings.HasSuffix(text, "}\n") {
		t.Errorf("file does not end in a newline: %q", text[len(text)-3:])
	}
	if !strings.Contains(text, "\n \"cells\": [\n") {
		t.Errorf("not indented by one space:\n%s", text)
	}
	if cells, meta := strings.Index(text, `"cells"`), strings.Index(text, `"metadata"`); cells > meta {
		t.Errorf("keys are not sorted:\n%s", text)
	}
}

func TestReadRejectsWhatCannotBeRead(t *testing.T) {
	cases := []struct {
		name, data, wants string
	}{
		{"malformed json", `{"cells": [`, "not a valid notebook"},
		{"not an object", `[]`, "not a valid notebook"},
		{"no version", `{"cells": [], "metadata": {}}`, "no nbformat version"},
		{"a version from the future", `{"cells": [], "metadata": {}, "nbformat": 9, "nbformat_minor": 0}`, "newer than this build"},
		{"version 1", `{"cells": [], "metadata": {}, "nbformat": 1, "nbformat_minor": 0}`, "too old"},
		{"cells is not a list", `{"cells": 3, "metadata": {}, "nbformat": 4, "nbformat_minor": 4}`, "cells: not a list"},
		{"metadata is not an object", `{"cells": [], "metadata": 3, "nbformat": 4, "nbformat_minor": 4}`, "metadata: not an object"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := Read([]byte(testCase.data))
			if err == nil {
				t.Fatalf("expected an error")
			}
			if !strings.Contains(err.Error(), testCase.wants) {
				t.Errorf("error %q does not mention %q", err, testCase.wants)
			}
		})
	}
}

// Everything a notebook can survive is read, and reported rather than refused.
func TestReadCarriesOnPastRecoverableProblems(t *testing.T) {
	doc, err := Read([]byte(`{
		"cells": [{"cell_type": "code", "source": "1", "metadata": {},
		           "outputs": [{"output_type": "stream", "text": "hi"}]}],
		"metadata": {}, "nbformat": 4, "nbformat_minor": 5
	}`))
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	if len(doc.Cells()) != 1 {
		t.Fatalf("expected the cell to be read, got %d cells", len(doc.Cells()))
	}

	problems := Validate(doc)
	found := map[string]bool{}
	for _, problem := range problems {
		found[problem.Path] = true
	}
	for _, path := range []string{"cells[0].id", "cells[0].execution_count", "cells[0].outputs[0].name"} {
		if !found[path] {
			t.Errorf("expected a problem at %s, got %v", path, problems)
		}
	}
}

func TestValidate(t *testing.T) {
	cases := []struct {
		name, cell string
		minor      int
		wants      string
	}{
		{"an id before 4.5", `{"cell_type": "raw", "source": "", "metadata": {}, "id": "abc"}`, 4, "cell ids arrived in 4.5"},
		{"no id from 4.5", `{"cell_type": "raw", "source": "", "metadata": {}}`, 5, "required from 4.5"},
		{"an id with a space in it", `{"cell_type": "raw", "source": "", "metadata": {}, "id": "a b"}`, 5, "contains characters other than"},
		{"attachments on a code cell", `{"cell_type": "code", "source": "", "metadata": {}, "execution_count": null, "outputs": [], "attachments": {}}`, 5, "not allowed on a code cell"},
		{"attachments before 4.1", `{"cell_type": "markdown", "source": "", "metadata": {}, "attachments": {}}`, 0, "not allowed before 4.1"},
		{"outputs on a markdown cell", `{"cell_type": "markdown", "source": "", "metadata": {}, "outputs": []}`, 4, "only allowed on a code cell"},
		{"an unknown cell type", `{"cell_type": "heading", "source": "", "metadata": {}}`, 4, `unknown cell type "heading"`},
		{"source that is not text", `{"cell_type": "raw", "source": 3, "metadata": {}}`, 4, "not a string or list of strings"},
		{"a stream with no name", `{"cell_type": "code", "source": "", "metadata": {}, "execution_count": null, "outputs": [{"output_type": "stream", "text": ""}]}`, 4, "missing on a stream output"},
		{"a stream named neither", `{"cell_type": "code", "source": "", "metadata": {}, "execution_count": null, "outputs": [{"output_type": "stream", "name": "stdlog", "text": ""}]}`, 4, "neither stdout nor stderr"},
		{"a result with no data", `{"cell_type": "code", "source": "", "metadata": {}, "execution_count": null, "outputs": [{"output_type": "execute_result", "metadata": {}, "execution_count": 1}]}`, 4, "missing on a execute_result output"},
		{"a traceback that is not a list", `{"cell_type": "code", "source": "", "metadata": {}, "execution_count": null, "outputs": [{"output_type": "error", "ename": "E", "evalue": "v", "traceback": "one frame"}]}`, 4, "traceback: not a list"},
		{"an unknown output type", `{"cell_type": "code", "source": "", "metadata": {}, "execution_count": null, "outputs": [{"output_type": "pyout"}]}`, 4, `unknown output type "pyout"`},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			doc := Document{
				"nbformat": json.Number("4"), "nbformat_minor": json.Number(strconv.Itoa(testCase.minor)),
				"metadata": map[string]interface{}{},
			}
			var cell interface{}
			if err := json.Unmarshal([]byte(testCase.cell), &cell); err != nil {
				t.Fatalf("bad test case: %v", err)
			}
			doc["cells"] = []interface{}{cell}

			problems := Validate(doc)
			found := false
			for _, problem := range problems {
				if strings.Contains(problem.Error(), testCase.wants) {
					found = true
				}
				if problem.Fatal {
					t.Errorf("problem %v is marked fatal; only unreadable JSON types are", problem)
				}
			}
			if !found {
				t.Errorf("expected a problem mentioning %q, got %v", testCase.wants, problems)
			}
		})
	}
}

func TestValidateDuplicateCellIDs(t *testing.T) {
	doc := Document{
		"nbformat": 4, "nbformat_minor": 5, "metadata": map[string]interface{}{},
		"cells": []interface{}{
			map[string]interface{}{"cell_type": "raw", "source": "", "metadata": map[string]interface{}{}, "id": "same"},
			map[string]interface{}{"cell_type": "raw", "source": "", "metadata": map[string]interface{}{}, "id": "same"},
		},
	}
	problems := Validate(doc)
	if len(problems) != 1 || !strings.Contains(problems[0].Message, "already the id of cells[0]") {
		t.Errorf("expected one duplicate-id problem, got %v", problems)
	}
}
