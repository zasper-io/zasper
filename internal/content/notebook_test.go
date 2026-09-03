package content

import (
	"encoding/json"
	"reflect"
	"testing"
)

// nbformat's multiline strings may be a string or a list of strings, and mean the same text either
// way.
func TestNbformatReadsAcceptsBothSourceShapes(t *testing.T) {
	tests := []struct {
		name string
		data string
	}{
		{
			name: "source as a list of lines",
			data: `{"cells": [{"cell_type": "code", "source": ["print(1)\n", "print(2)"],
			         "outputs": [{"output_type": "stream", "text": ["1\n", "2"]}]}]}`,
		},
		{
			name: "source as a single string",
			data: `{"cells": [{"cell_type": "code", "source": "print(1)\nprint(2)",
			         "outputs": [{"output_type": "stream", "text": "1\n2"}]}]}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			nb, err := nbformatReads(tt.data, 4, false)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(nb.Cells) != 1 {
				t.Fatalf("expected 1 cell, got %d", len(nb.Cells))
			}
			if nb.Cells[0].Source != "print(1)\nprint(2)" {
				t.Errorf("expected the source to be rejoined, got %q", nb.Cells[0].Source)
			}
			if len(nb.Cells[0].Outputs) != 1 || nb.Cells[0].Outputs[0].Text != "1\n2" {
				t.Errorf("expected the output text to be rejoined, got %+v", nb.Cells[0].Outputs)
			}
		})
	}
}

func TestNbformatReadsKeepsTheVersion(t *testing.T) {
	nb, err := nbformatReads(`{"cells": [], "nbformat": 4, "nbformat_minor": 4}`, 4, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if nb.Nbformat != 4 || nb.NbformatMinor != 4 {
		t.Errorf("expected 4.4, got %d.%d", nb.Nbformat, nb.NbformatMinor)
	}
}

// The shapes a fixed struct could not hold: an object kernelspec, a codemirror_mode that is an
// object rather than a string, and a key nothing here knows about.
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

	nb, err := nbformatReads(disk, 4, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	written, err := json.Marshal(convertToNbDisk(nb))
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var got struct {
		Nbformat      int `json:"nbformat"`
		NbformatMinor int `json:"nbformat_minor"`
		Metadata      struct {
			KernelSpec struct {
				Name        string `json:"name"`
				DisplayName string `json:"display_name"`
			} `json:"kernelspec"`
			LanguageInfo struct {
				CodemirrorMode struct {
					Name string `json:"name"`
				} `json:"codemirror_mode"`
			} `json:"language_info"`
			Widgets map[string]interface{} `json:"widgets"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal(written, &got); err != nil {
		t.Fatalf("failed to unmarshal what was written: %v", err)
	}

	if got.Metadata.KernelSpec.Name != "python3" || got.Metadata.KernelSpec.DisplayName != "Python 3" {
		t.Errorf("kernelspec did not round-trip: %s", written)
	}
	if got.Metadata.LanguageInfo.CodemirrorMode.Name != "ipython" {
		t.Errorf("codemirror_mode did not round-trip: %s", written)
	}
	if got.Metadata.Widgets == nil {
		t.Errorf("an unknown metadata key was dropped: %s", written)
	}
	if got.Nbformat != 4 || got.NbformatMinor != 4 {
		t.Errorf("expected the file's own 4.4 to be kept, got %d.%d", got.Nbformat, got.NbformatMinor)
	}
}

func TestNbformatReadsReportsCorruption(t *testing.T) {
	tests := []struct {
		name string
		data string
	}{
		{name: "not JSON", data: `not a notebook at all`},
		{name: "cells is not a list", data: `{"cells": 5}`},
		{name: "source is neither a string nor a list", data: `{"cells": [{"source": 42}]}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := nbformatReads(tt.data, 4, false); err == nil {
				t.Error("expected an error rather than a notebook with empty cells")
			}
		})
	}
}

func TestSplitMimeBundle(t *testing.T) {
	tests := []struct {
		name     string
		data     map[string]interface{}
		expected map[string]interface{}
	}{
		{
			name: "Split text MIME types and preserve non-text",
			data: map[string]interface{}{
				"text/plain":             "Hello\nWorld\nThis is a test.",
				"image/svg+xml":          "<svg>...</svg>",       // should remain unchanged
				"application/javascript": "console.log('test');", // should remain unchanged
				"application/json":       `{"key": "value"}`,     // should remain unchanged
			},
			expected: map[string]interface{}{
				"text/plain":             []string{"Hello\n", "World\n", "This is a test."},
				"image/svg+xml":          "<svg>...</svg>",
				"application/javascript": "console.log('test');",
				"application/json":       `{"key": "value"}`,
			},
		},
		{
			name: "Only text MIME types should be split",
			data: map[string]interface{}{
				"text/html": "<html>\n<head>\n<title>Test</title>\n</head>\n</html>", // should split
				"image/png": "binarydata",                                            // should remain unchanged
			},
			expected: map[string]interface{}{
				"text/html": []string{
					"<html>\n", "<head>\n", "<title>Test</title>\n", "</head>\n", "</html>",
				},
				"image/png": "binarydata",
			},
		},
		{
			name: "Non-text MIME types remain unchanged",
			data: map[string]interface{}{
				"application/xml":  "<root><node>value</node></root>", // should remain unchanged
				"application/json": `{"name": "value"}`,               // should remain unchanged
			},
			expected: map[string]interface{}{
				"application/xml":  "<root><node>value</node></root>",
				"application/json": `{"name": "value"}`,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := splitMimeBundle(tt.data)

			// Check if the result matches the expected output
			if !reflect.DeepEqual(result, tt.expected) {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestRejoinMimeBundle(t *testing.T) {
	tests := []struct {
		name     string
		data     map[string]interface{}
		expected map[string]interface{}
	}{
		{
			name: "Rejoin text MIME types",
			data: map[string]interface{}{
				"text/plain":    []interface{}{"Hello\n", "World\n", "This is a test."},
				"image/svg+xml": "<svg>...</svg>", // should remain unchanged
			},
			expected: map[string]interface{}{
				"text/plain":    "Hello\nWorld\nThis is a test.",
				"image/svg+xml": "<svg>...</svg>",
			},
		},
		{
			name: "Leave non-text MIME types unchanged",
			data: map[string]interface{}{
				"application/json": `{"key": "value"}`,                // should remain unchanged
				"application/xml":  "<root><node>value</node></root>", // should remain unchanged
			},
			expected: map[string]interface{}{
				"application/json": `{"key": "value"}`,
				"application/xml":  "<root><node>value</node></root>",
			},
		},
		{
			name: "Handle non-list values",
			data: map[string]interface{}{
				"application/json": map[string]interface{}{"key": "value"}, // should remain unchanged
				"other/mime":       123,                                    // should remain unchanged
			},
			expected: map[string]interface{}{
				"application/json": `map[key:value]`,
				"other/mime":       "123",
			},
		},
		{
			name: "Handle mixed types with some lists",
			data: map[string]interface{}{
				"text/html":        []interface{}{"<html>", "<body>", "</body>", "</html>"},
				"application/json": `{"name": "value"}`, // should remain unchanged
			},
			expected: map[string]interface{}{
				"text/html":        "<html><body></body></html>",
				"application/json": `{"name": "value"}`,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := rejoinMimeBundle(tt.data)

			// Check if the result matches the expected output
			if !reflect.DeepEqual(result, tt.expected) {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}
