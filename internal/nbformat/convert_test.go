package nbformat

import (
	"strings"
	"testing"
)

/*
The version 3 fixture is the version 4 one, downgraded by nbformat: cells under `worksheets`, `input`
instead of `source`, `prompt_number`, `pyout` and `pyerr` outputs and sibling mime keys. Reading it
has to produce the version 4 notebook it came from.
*/
func TestReadUpgradesVersion3(t *testing.T) {
	doc, err := Read(readFixture(t, "v3"))
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}

	if major, minor := doc.Version(); major != 4 || minor != 5 {
		t.Errorf("upgraded to %s, want 4.5", versionString(major, minor))
	}
	if _, present := doc["worksheets"]; present {
		t.Error("worksheets survived the upgrade")
	}

	cells := doc.Cells()
	if len(cells) != 3 {
		t.Fatalf("expected the 3 cells out of the worksheet, got %d", len(cells))
	}

	code := cells[0]
	if _, present := code["input"]; present {
		t.Error("code cell kept its v3 `input` key")
	}
	if source, _ := stringValue(code["source"]); source != "print('one')\nprint('two')" {
		t.Errorf("input did not become source: %#v", code["source"])
	}
	if count, _ := intValue(code["execution_count"]); count != 1 {
		t.Errorf("prompt_number did not become execution_count: %#v", code["execution_count"])
	}

	outputs, _ := sliceValue(code["outputs"])
	if len(outputs) != 3 {
		t.Fatalf("expected 3 outputs, got %d", len(outputs))
	}
	types := []string{}
	for _, entry := range outputs {
		output, _ := mapValue(entry)
		outputType, _ := stringValue(output["output_type"])
		types = append(types, outputType)
	}
	if strings.Join(types, ",") != "stream,execute_result,error" {
		t.Errorf("output types after upgrade: %v", types)
	}

	result, _ := mapValue(outputs[1])
	data, _ := mapValue(result["data"])
	if plain, _ := stringValue(data["text/plain"]); plain != "42" {
		t.Errorf("the v3 `text` key did not become text/plain: %#v", data)
	}
	if html, _ := stringValue(data["text/html"]); html != "<b>42</b>" {
		t.Errorf("the v3 `html` key did not become text/html: %#v", data)
	}

	if problems := Validate(doc); len(problems) > 0 {
		t.Errorf("upgraded notebook is not valid 4.5: %v", problems)
	}
}

// An upgraded notebook is written back as a 4.5 file, because the version it came from cannot hold
// what it now is. Writing it twice must be the same file both times.
func TestWritingAnUpgradedNotebookIsStable(t *testing.T) {
	doc, err := Read(readFixture(t, "v3"))
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	first, err := Marshal(doc)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	reread, err := Read(first)
	if err != nil {
		t.Fatalf("Read of the upgraded file failed: %v", err)
	}
	second, err := Marshal(reread)
	if err != nil {
		t.Fatalf("second Marshal failed: %v", err)
	}
	if string(first) != string(second) {
		t.Errorf("writing twice gave two different files:\n--- first ---\n%s\n--- second ---\n%s", first, second)
	}
}

func TestUpgradeHeadingAndHTMLCells(t *testing.T) {
	doc := Document{
		"nbformat": 3, "nbformat_minor": 0, "metadata": map[string]interface{}{},
		"worksheets": []interface{}{map[string]interface{}{"cells": []interface{}{
			map[string]interface{}{"cell_type": "heading", "level": 2, "source": "A title\nover two lines"},
			map[string]interface{}{"cell_type": "html", "source": "<b>hi</b>"},
			map[string]interface{}{"cell_type": "code", "language": "python", "collapsed": true,
				"input": "1", "prompt_number": 3, "outputs": []interface{}{}},
		}}},
	}
	if err := Convert(doc); err != nil {
		t.Fatalf("Convert failed: %v", err)
	}

	cells := doc.Cells()
	heading, html, code := cells[0], cells[1], cells[2]

	if cellType, _ := stringValue(heading["cell_type"]); cellType != "markdown" {
		t.Errorf("heading cell became %q", cellType)
	}
	// A heading is one line in markdown, so the lines are joined with spaces rather than kept.
	if source, _ := stringValue(heading["source"]); source != "## A title over two lines" {
		t.Errorf("heading source = %q", source)
	}
	if _, present := heading["level"]; present {
		t.Error("heading kept its level")
	}
	if cellType, _ := stringValue(html["cell_type"]); cellType != "markdown" {
		t.Errorf("html cell became %q", cellType)
	}
	if _, present := code["language"]; present {
		t.Error("code cell kept its language")
	}
	metadata, _ := mapValue(code["metadata"])
	if collapsed, _ := metadata["collapsed"].(bool); !collapsed {
		t.Errorf("collapsed did not move into the cell metadata: %#v", metadata)
	}
	if _, present := code["collapsed"]; present {
		t.Error("collapsed stayed on the cell")
	}
}

func TestConvertRefusesVersion1(t *testing.T) {
	doc := Document{"nbformat": 1, "nbformat_minor": 0}
	err := Convert(doc)
	if err == nil || !strings.Contains(err.Error(), "too old") {
		t.Errorf("expected a too-old error, got %v", err)
	}
}

func TestConvertLeavesVersion4Alone(t *testing.T) {
	doc, err := Read(readFixture(t, "v4.4"))
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	if err := Convert(doc); err != nil {
		t.Fatalf("Convert failed: %v", err)
	}
	if major, minor := doc.Version(); major != 4 || minor != 4 {
		t.Errorf("Convert changed a 4.4 notebook to %s", versionString(major, minor))
	}
}

/*
The transient keys: nbformat drops them when it reads and again when it writes, so a notebook that
carries them loses them, and one that does not never gains them.
*/
func TestTransientKeysAreDropped(t *testing.T) {
	doc, err := Read([]byte(`{
		"cells": [{"cell_type": "raw", "source": "", "id": "aaaa1111",
		           "metadata": {"trusted": true, "kept": 1}}],
		"metadata": {"orig_nbformat": 3, "orig_nbformat_minor": 0, "signature": "hash", "kept": 2},
		"nbformat": 4, "nbformat_minor": 5
	}`))
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}

	for _, key := range transientMetadataKeys {
		if _, present := doc.Metadata()[key]; present {
			t.Errorf("notebook metadata kept %q", key)
		}
	}
	if _, present := doc.Metadata()["kept"]; !present {
		t.Error("an ordinary metadata key was dropped along with the transient ones")
	}
	cellMetadata, _ := mapValue(doc.Cells()[0]["metadata"])
	if _, present := cellMetadata["trusted"]; present {
		t.Error("cell metadata kept `trusted`")
	}
	if _, present := cellMetadata["kept"]; !present {
		t.Error("an ordinary cell metadata key was dropped")
	}
}
