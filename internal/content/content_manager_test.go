package content

import (
	"encoding/base64"
	"errors"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestReadFileContent(t *testing.T) {

	tests := []struct {
		name        string
		filePath    string
		fileContent string
		expected    string
		expectedErr error
	}{
		{
			name:        "Read normal text file",
			filePath:    "testfile.txt",
			fileContent: "This is a normal text file",
			expected:    "This is a normal text file",
			expectedErr: nil,
		},
		{
			name:        "Read .png file",
			filePath:    "image.png",
			fileContent: string([]byte{0x89, 0x50, 0x4E, 0x47}), // Part of a PNG file
			expected:    "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte{0x89, 0x50, 0x4E, 0x47}),
			expectedErr: nil,
		},
		{
			name:        "Error reading nonexistent file",
			filePath:    "nonexistentfile.txt",
			fileContent: "",
			expected:    "",
			expectedErr: errors.New("open nonexistentfile.txt: no such file or directory"),
		},
	}

	// Iterate over the test cases
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Step 1: Create a temporary file and write the test content to it
			if tt.expectedErr == nil {
				tmpFile, err := os.CreateTemp("", tt.filePath)
				if err != nil {
					t.Fatalf("Failed to create temporary file: %v", err)
				}
				if err != os.Rename(tmpFile.Name(), tt.filePath) {
					t.Fatalf("Failed to rename file: %v", err)
				}

				defer os.Remove(tt.filePath) // Clean up the file after the test

				// Write the content to the file
				if err := os.WriteFile(tt.filePath, []byte(tt.fileContent), 0644); err != nil {
					t.Fatalf("Failed to write content to temporary file: %v", err)
				}

				// Step 2: Call the function under test with the temporary file
				result, err := readFileContent(tt.filePath)

				// Step 3: Assert the results
				if tt.expectedErr != nil {
					assert.Error(t, err)
					assert.Contains(t, err.Error(), tt.expectedErr.Error())
				} else {
					assert.NoError(t, err)
					assert.Equal(t, tt.expected, result)
				}
			} else {
				// Step 2: If the file doesn't exist, don't create it.
				result, err := readFileContent(tt.filePath)

				// Step 3: Assert the results
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedErr.Error())
				assert.Equal(t, tt.expected, result)
			}
		})
	}
}
