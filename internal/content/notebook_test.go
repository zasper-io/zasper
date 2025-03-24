package content

import (
	"reflect"
	"testing"
)

func TestSplitMimeBundle(t *testing.T) {
	tests := []struct {
		name     string
		data     map[string]string
		expected map[string]interface{}
	}{
		{
			name: "Split text MIME types and preserve non-text",
			data: map[string]string{
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
			data: map[string]string{
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
			data: map[string]string{
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
			result := _splitMimeBundle(tt.data)

			// Check if the result matches the expected output
			if !reflect.DeepEqual(result, tt.expected) {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}
