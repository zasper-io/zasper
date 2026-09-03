package content

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/models"
)

// Points HomeDir at a fresh directory and moves the process to a different one, so a path resolved
// against the working directory rather than HomeDir lands somewhere the assertions can see.
func projectDirElsewhere(t *testing.T) string {
	t.Helper()

	projectDir := t.TempDir()
	previous := core.Zasper.HomeDir
	core.Zasper.HomeDir = projectDir
	t.Cleanup(func() { core.Zasper.HomeDir = previous })
	t.Chdir(t.TempDir())

	return projectDir
}

func TestUpdateNbContentWritesInsideTheProjectDirectory(t *testing.T) {
	projectDir := projectDirElsewhere(t)

	err := UpdateNbContent("notes.ipynb", "notebook", "json",
		`{"cells": [{"cell_type": "code", "source": "print(1)"}], "nbformat": 4, "nbformat_minor": 4}`)
	assert.NoError(t, err)

	written, err := os.ReadFile(filepath.Join(projectDir, "notes.ipynb"))
	assert.NoError(t, err, "the notebook should be written under HomeDir")
	assert.Contains(t, string(written), "print(1)")

	cwd, err := os.Getwd()
	assert.NoError(t, err)
	assert.NoFileExists(t, filepath.Join(cwd, "notes.ipynb"), "nothing should be written to the cwd")
}

func TestUpdateContentWritesInsideTheProjectDirectory(t *testing.T) {
	projectDir := projectDirElsewhere(t)

	err := UpdateContent("notes.txt", "file", "text", "hello")
	assert.NoError(t, err)

	written, err := os.ReadFile(filepath.Join(projectDir, "notes.txt"))
	assert.NoError(t, err)
	assert.Equal(t, "hello", string(written))
}

func TestWritesOutsideTheProjectDirectoryAreRefused(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	escape := filepath.Join(filepath.Dir(projectDir), "escaped.txt")

	err := UpdateContent("../escaped.txt", "file", "text", "hello")

	assert.Error(t, err, "a path that leaves the project directory should not be written")
	assert.NoFileExists(t, escape)
}

func TestGetSafePath(t *testing.T) {
	projectDir := projectDirElsewhere(t)

	assert.Equal(t, filepath.Join(projectDir, "a", "b.txt"), GetSafePath("a/b.txt"))
	assert.Equal(t, projectDir, GetSafePath("."), "the project directory itself is allowed")
	assert.Equal(t, "", GetSafePath("../elsewhere"))

	// A prefix test alone would pass this: the sibling directory's path starts with HomeDir's.
	assert.Equal(t, "", GetSafePath(".."+string(os.PathSeparator)+filepath.Base(projectDir)+"-secrets"))
}

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
