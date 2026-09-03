package nbformat

import (
	"reflect"
	"testing"
)

// A multiline string may be written either way, and means the same text either way.
func TestReadAcceptsBothSourceShapes(t *testing.T) {
	tests := []struct {
		name string
		data string
	}{
		{
			name: "source as a list of lines",
			data: `{"cells": [{"cell_type": "code", "metadata": {}, "execution_count": null,
			         "source": ["print(1)\n", "print(2)"],
			         "outputs": [{"output_type": "stream", "name": "stdout", "text": ["1\n", "2"]}]}],
			        "metadata": {}, "nbformat": 4, "nbformat_minor": 4}`,
		},
		{
			name: "source as a single string",
			data: `{"cells": [{"cell_type": "code", "metadata": {}, "execution_count": null,
			         "source": "print(1)\nprint(2)",
			         "outputs": [{"output_type": "stream", "name": "stdout", "text": "1\n2"}]}],
			        "metadata": {}, "nbformat": 4, "nbformat_minor": 4}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			doc, err := Read([]byte(tt.data))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			cells := doc.Cells()
			if len(cells) != 1 {
				t.Fatalf("expected 1 cell, got %d", len(cells))
			}
			if source, _ := stringValue(cells[0]["source"]); source != "print(1)\nprint(2)" {
				t.Errorf("expected the source to be joined, got %#v", cells[0]["source"])
			}
			outputs, _ := sliceValue(cells[0]["outputs"])
			output, _ := mapValue(outputs[0])
			if text, _ := stringValue(output["text"]); text != "1\n2" {
				t.Errorf("expected the output text to be joined, got %#v", output["text"])
			}
		})
	}
}

/*
Which members of a mime bundle get split is the detail with the most ways to go wrong. Only text
does: base64 image data is one long string that means one thing, and a list of lines of it is not
what any other tool writes.
*/
func TestSplitBundle(t *testing.T) {
	tests := []struct {
		name     string
		data     map[string]interface{}
		expected map[string]interface{}
	}{
		{
			name: "text is split, javascript and svg with it",
			data: map[string]interface{}{
				"text/plain":             "Hello\nWorld\nThis is a test.",
				"image/svg+xml":          "<svg>\n</svg>",
				"application/javascript": "console.log('a');\nconsole.log('b');",
			},
			expected: map[string]interface{}{
				"text/plain":             []interface{}{"Hello\n", "World\n", "This is a test."},
				"image/svg+xml":          []interface{}{"<svg>\n", "</svg>"},
				"application/javascript": []interface{}{"console.log('a');\n", "console.log('b');"},
			},
		},
		{
			name: "image data and JSON are left alone",
			data: map[string]interface{}{
				"text/html":        "<html>\n</html>",
				"image/png":        "iVBORw0KGgo=",
				"application/json": map[string]interface{}{"key": "value"},
				"application/xml":  "<root>\n</root>",
			},
			expected: map[string]interface{}{
				"text/html":        []interface{}{"<html>\n", "</html>"},
				"image/png":        "iVBORw0KGgo=",
				"application/json": map[string]interface{}{"key": "value"},
				"application/xml":  "<root>\n</root>",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			splitBundle(tt.data)
			if !reflect.DeepEqual(tt.data, tt.expected) {
				t.Errorf("expected %#v, got %#v", tt.expected, tt.data)
			}
		})
	}
}

func TestJoinBundle(t *testing.T) {
	tests := []struct {
		name     string
		data     map[string]interface{}
		expected map[string]interface{}
	}{
		{
			name: "every list of lines is joined, whatever its mime type",
			data: map[string]interface{}{
				"text/plain":    []interface{}{"Hello\n", "World"},
				"image/svg+xml": []interface{}{"<svg>\n", "</svg>"},
				"image/png":     "iVBORw0KGgo=",
			},
			expected: map[string]interface{}{
				"text/plain":    "Hello\nWorld",
				"image/svg+xml": "<svg>\n</svg>",
				"image/png":     "iVBORw0KGgo=",
			},
		},
		{
			// The old implementation ran every value through fmt.Sprint, which turned a JSON object
			// into `map[key:value]` and destroyed it.
			name: "JSON keeps its shape, and so does anything that is not lines of text",
			data: map[string]interface{}{
				"application/json":     map[string]interface{}{"key": "value"},
				"application/ld+json":  []interface{}{map[string]interface{}{"key": "value"}},
				"application/x-thing":  []interface{}{"a", 42},
				"application/x-number": 123,
			},
			expected: map[string]interface{}{
				"application/json":     map[string]interface{}{"key": "value"},
				"application/ld+json":  []interface{}{map[string]interface{}{"key": "value"}},
				"application/x-thing":  []interface{}{"a", 42},
				"application/x-number": 123,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			joinBundle(tt.data)
			if !reflect.DeepEqual(tt.data, tt.expected) {
				t.Errorf("expected %#v, got %#v", tt.expected, tt.data)
			}
		})
	}
}

/*
splitLines has to match Python's `str.splitlines(keepends=True)`, because that is what wrote every
notebook Zasper will ever open. The cases below are the ones where the obvious Go implementation,
strings.SplitAfter, gives a different answer.
*/
func TestSplitLines(t *testing.T) {
	tests := []struct {
		text     string
		expected []string
	}{
		{"", nil},
		{"a", []string{"a"}},
		{"a\n", []string{"a\n"}},
		{"a\nb", []string{"a\n", "b"}},
		{"a\n\nb", []string{"a\n", "\n", "b"}},
		{"a\r\nb", []string{"a\r\n", "b"}},
		{"a\rb", []string{"a\r", "b"}},
		{"a\u2028b", []string{"a\u2028", "b"}},
	}

	for _, tt := range tests {
		t.Run(tt.text, func(t *testing.T) {
			got := splitLines(tt.text)
			if len(tt.expected) == 0 && len(got) == 0 {
				return
			}
			if !reflect.DeepEqual(got, tt.expected) {
				t.Errorf("splitLines(%q) = %#v, want %#v", tt.text, got, tt.expected)
			}
		})
	}
}

// Splitting text and joining it again is the text, which is what makes a save that changes nothing
// change nothing.
func TestSplitThenJoinIsTheSameText(t *testing.T) {
	for _, text := range []string{"", "a", "a\n", "a\nb", "a\r\nb\n\n", "a\u2028b", "\n\n\n"} {
		joined := joinLines(toInterfaces(splitLines(text)))
		if joined != text {
			t.Errorf("%q became %#v", text, joined)
		}
	}
}

// The metadata shapes a fixed set of Go structs could not hold: an object where a string might be
// expected, and keys nothing in this package knows.
func TestMetadataRoundTripsUnrepresentableShapes(t *testing.T) {
	const disk = `{
		"cells": [],
		"nbformat": 4,
		"nbformat_minor": 4,
		"metadata": {
			"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
			"language_info": {"name": "python", "codemirror_mode": {"name": "ipython", "version": 3}},
			"widgets": {"state": {}}
		}
	}`

	doc, err := Read([]byte(disk))
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	written, err := Marshal(doc)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	reread, err := Read(written)
	if err != nil {
		t.Fatalf("Read of the written file failed: %v", err)
	}

	if !reflect.DeepEqual(reread.Metadata(), doc.Metadata()) {
		t.Errorf("metadata did not round-trip:\nwant %#v\ngot  %#v", doc.Metadata(), reread.Metadata())
	}
	if _, ok := mapValue(reread.Metadata()["widgets"]); !ok {
		t.Errorf("an unknown metadata key was dropped: %s", written)
	}
}
