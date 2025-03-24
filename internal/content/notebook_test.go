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
		expected map[string]string
	}{
		{
			name: "Rejoin text MIME types",
			data: map[string]interface{}{
				"text/plain":    []interface{}{"Hello", "World", "This is a test."},
				"image/svg+xml": "<svg>...</svg>", // should remain unchanged
			},
			expected: map[string]string{
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
			expected: map[string]string{
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
			expected: map[string]string{
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
			expected: map[string]string{
				"text/html":        "<html>\n<body>\n</body>\n</html>",
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
