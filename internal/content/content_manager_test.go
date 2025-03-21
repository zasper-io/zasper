package content

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/zasper-io/zasper/internal/models"
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
			if tt.expectedErr == nil {
				tmpFile, err := os.CreateTemp("", tt.filePath)
				if err != nil {
					t.Fatalf("Failed to create temporary file: %v", err)
				}
				if err != os.Rename(tmpFile.Name(), tt.filePath) {
					t.Fatalf("Failed to rename file: %v", err)
				}

				defer os.Remove(tt.filePath) // Clean up the file after the test

				if err := os.WriteFile(tt.filePath, []byte(tt.fileContent), 0644); err != nil {
					t.Fatalf("Failed to write content to temporary file: %v", err)
				}

				result, err := readFileContent(tt.filePath)

				if tt.expectedErr != nil {
					assert.Error(t, err)
					assert.Contains(t, err.Error(), tt.expectedErr.Error())
				} else {
					assert.NoError(t, err)
					assert.Equal(t, tt.expected, result)
				}
			} else {
				result, err := readFileContent(tt.filePath)

				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedErr.Error())
				assert.Equal(t, tt.expected, result)
			}
		})
	}
}

func TestGetFileModel(t *testing.T) {
	// Setup: create temporary directories and files for testing
	tmpDir, err := os.MkdirTemp("", "testdir")
	if err != nil {
		t.Fatalf("Failed to create temporary directory: %v", err)
	}
	defer os.RemoveAll(tmpDir) // Clean up after the test

	// Create files for testing
	normalFile := filepath.Join(tmpDir, "testfile.txt")
	err = os.WriteFile(normalFile, []byte("This is a normal file."), 0644)
	if err != nil {
		t.Fatalf("Failed to create normal file: %v", err)
	}

	// Create a directory for testing
	dirPath := filepath.Join(tmpDir, "testdir")
	err = os.Mkdir(dirPath, 0755)
	if err != nil {
		t.Fatalf("Failed to create directory: %v", err)
	}

	// Create a notebook file (.ipynb)
	notebookFile := filepath.Join(tmpDir, "testnotebook.ipynb")
	err = os.WriteFile(notebookFile, []byte("{}"), 0644)
	if err != nil {
		t.Fatalf("Failed to create notebook file: %v", err)
	}

	tests := []struct {
		name          string
		abspath       string
		relativePath  string
		fileName      string
		expectedModel models.ContentModel
		expectedErr   error
	}{
		{
			name:         "File",
			abspath:      tmpDir,
			relativePath: ".",
			fileName:     "testfile.txt",
			expectedModel: models.ContentModel{
				Name:          "testfile.txt",
				Path:          "testfile.txt",
				ContentType:   "file",
				Created:       time.Now().UTC().Format(time.RFC3339),
				Last_modified: time.Now().UTC().Format(time.RFC3339),
				Size:          int64(22), // Size of the file content
			},
			expectedErr: nil,
		},
		{
			name:         "Notebook file (.ipynb)",
			abspath:      tmpDir,
			relativePath: ".",
			fileName:     "testnotebook.ipynb",
			expectedModel: models.ContentModel{
				Name:          "testnotebook.ipynb",
				Path:          "testnotebook.ipynb",
				ContentType:   "notebook",
				Created:       time.Now().UTC().Format(time.RFC3339),
				Last_modified: time.Now().UTC().Format(time.RFC3339),
				Size:          int64(2), // Size of the notebook file content
			},
			expectedErr: nil,
		},
		{
			name:          "File not found",
			abspath:       tmpDir,
			relativePath:  ".",
			fileName:      "nonexistentfile.txt",
			expectedModel: models.ContentModel{},
			expectedErr:   errors.New("no such file or directory"),
		},
		{
			name:         "Relative Path",
			abspath:      tmpDir,
			relativePath: "some/relative/path",
			fileName:     "testfile.txt",
			expectedModel: models.ContentModel{
				Name:          "testfile.txt",
				Path:          "some/relative/path/testfile.txt",
				ContentType:   "file",
				Created:       time.Now().UTC().Format(time.RFC3339),
				Last_modified: time.Now().UTC().Format(time.RFC3339),
				Size:          int64(22),
			},
			expectedErr: nil,
		},
	}

	// Run the tests
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := getFileModel(tt.abspath, tt.relativePath, tt.fileName)
			if tt.expectedErr == nil {

				// can't test Created and Last_modified because they will be different each time
				// ignore those fields for comparison
				tt.expectedModel.Created = result.Created
				tt.expectedModel.Last_modified = result.Last_modified

				assert.Equal(t, tt.expectedModel, result)
			} else {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedErr.Error())
				assert.Equal(t, tt.expectedModel, result)
			}
		})
	}
}
