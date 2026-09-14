package content

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/iotest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/zasper-io/zasper/internal/models"
)

// testProject makes a project in a directory of its own, and runs the test in parallel.
func testProject(t *testing.T) (Project, string) {
	t.Helper()
	t.Parallel()

	projectDir := t.TempDir()
	return NewProject(projectDir), projectDir
}

func TestUpdateNbContentWritesInsideTheProjectDirectory(t *testing.T) {
	// Not in parallel: the process moves elsewhere, so a path resolved against the working directory
	// rather than the project lands somewhere the assertions can see.
	projectDir := t.TempDir()
	project := NewProject(projectDir)
	t.Chdir(t.TempDir())

	err := project.UpdateNbContent("notes.ipynb", "notebook", "json",
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
	project, projectDir := testProject(t)

	err := project.UpdateContent("notes.txt", "file", "text", "hello")
	assert.NoError(t, err)

	written, err := os.ReadFile(filepath.Join(projectDir, "notes.txt"))
	assert.NoError(t, err)
	assert.Equal(t, "hello", string(written))
}

func TestWritesOutsideTheProjectDirectoryAreRefused(t *testing.T) {
	project, projectDir := testProject(t)
	escape := filepath.Join(filepath.Dir(projectDir), "escaped.txt")

	err := project.UpdateContent("../escaped.txt", "file", "text", "hello")

	assert.Error(t, err, "a path that leaves the project directory should not be written")
	assert.NoFileExists(t, escape)
}

func TestSafePath(t *testing.T) {
	project, projectDir := testProject(t)

	assert.Equal(t, filepath.Join(projectDir, "a", "b.txt"), project.SafePath("a/b.txt"))
	assert.Equal(t, projectDir, project.SafePath("."), "the project directory itself is allowed")
	assert.Equal(t, projectDir, project.SafePath(""), "an empty path is the project directory")
	assert.Equal(t, filepath.Join(projectDir, "a", "b.txt"), project.SafePath("/a/b.txt"), "an absolute path reads as project-relative")
	assert.Equal(t, "", project.SafePath("../elsewhere"))

	// A prefix test alone would pass this: the sibling directory's path starts with HomeDir's.
	assert.Equal(t, "", project.SafePath(".."+string(os.PathSeparator)+filepath.Base(projectDir)+"-secrets"))
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
				Name:         "testfile.txt",
				Path:         "testfile.txt",
				ContentType:  "file",
				Created:      time.Now().UTC().Format(time.RFC3339),
				LastModified: time.Now().UTC().Format(time.RFC3339),
				Writable:     true,
				Size:         int64(22), // Size of the file content
			},
			expectedErr: nil,
		},
		{
			name:         "Notebook file (.ipynb)",
			abspath:      tmpDir,
			relativePath: ".",
			fileName:     "testnotebook.ipynb",
			expectedModel: models.ContentModel{
				Name:         "testnotebook.ipynb",
				Path:         "testnotebook.ipynb",
				ContentType:  "notebook",
				Created:      time.Now().UTC().Format(time.RFC3339),
				LastModified: time.Now().UTC().Format(time.RFC3339),
				Writable:     true,
				Size:         int64(2), // Size of the notebook file content
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
				Name:         "testfile.txt",
				Path:         "some/relative/path/testfile.txt",
				ContentType:  "file",
				Created:      time.Now().UTC().Format(time.RFC3339),
				LastModified: time.Now().UTC().Format(time.RFC3339),
				Writable:     true,
				Size:         int64(22),
			},
			expectedErr: nil,
		},
	}

	// Run the tests
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := getFileModel(tt.abspath, tt.relativePath, tt.fileName)
			if tt.expectedErr == nil {

				// The timestamps differ on every run, so they are not compared.
				tt.expectedModel.Created = result.Created
				tt.expectedModel.LastModified = result.LastModified

				assert.Equal(t, tt.expectedModel, result)
			} else {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedErr.Error())
				assert.Equal(t, tt.expectedModel, result)
			}
		})
	}
}

func TestRenameRefusesToOverwriteASibling(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "keep.txt"), []byte("keep"), 0o644))
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "other.txt"), []byte("other"), 0o644))

	err := project.rename("", "other.txt", "keep.txt")

	assert.ErrorIs(t, err, errTargetExists)
	kept, readErr := os.ReadFile(filepath.Join(projectDir, "keep.txt"))
	assert.NoError(t, readErr)
	assert.Equal(t, "keep", string(kept), "the existing file should be untouched")
	assert.FileExists(t, filepath.Join(projectDir, "other.txt"))
}

func TestRenameReportsWhatWentWrong(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "notes.txt"), []byte("hello"), 0o644))

	assert.Error(t, project.rename("", "notes.txt", "  "), "an empty name is not a rename")
	assert.Error(t, project.rename("", "missing.txt", "notes2.txt"))
	assert.Error(t, project.rename("", "notes.txt", "../escaped.txt"))
	assert.NoFileExists(t, filepath.Join(filepath.Dir(projectDir), "escaped.txt"))

	assert.NoError(t, project.rename("", "notes.txt", "renamed.txt"))
	assert.FileExists(t, filepath.Join(projectDir, "renamed.txt"))
}

func TestDeleteFileRemovesANonEmptyDirectory(t *testing.T) {
	project, projectDir := testProject(t)
	nested := filepath.Join(projectDir, "folder", "inner")
	assert.NoError(t, os.MkdirAll(nested, 0o755))
	assert.NoError(t, os.WriteFile(filepath.Join(nested, "notes.txt"), []byte("hello"), 0o644))

	assert.NoError(t, project.deleteFile("folder"))

	assert.NoDirExists(t, filepath.Join(projectDir, "folder"))
}

func TestDeleteFileSaysWhenThereIsNothingToDelete(t *testing.T) {
	project, _ := testProject(t)

	err := project.deleteFile("missing.txt")

	assert.ErrorIs(t, err, os.ErrNotExist)
}

func TestDeleteFileRefusesTheProjectItself(t *testing.T) {
	project, projectDir := testProject(t)
	notebook := filepath.Join(projectDir, "analysis.ipynb")
	assert.NoError(t, os.WriteFile(notebook, []byte("{}"), 0o644))

	for _, path := range []string{"", ".", "/", "./", "folder/.."} {
		assert.ErrorIs(t, project.deleteFile(path), errProjectRoot, "path %q", path)
	}

	assert.FileExists(t, notebook)
}

func TestCreateDirectoryAnswersWithAProjectRelativePath(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "src", "untitled-directory"), 0o755))

	// The client looks the new row up in the listing by the path it is given, and listings are
	// project-relative.
	model, err := project.CreateDirectory(ContentPayload{ParentDir: "src", ContentType: "directory"})

	assert.NoError(t, err)
	assert.Equal(t, filepath.Join("src", "untitled-directory-1"), model.Path)
	assert.Equal(t, "untitled-directory-1", model.Name, "the name should be the one that was free")
	assert.DirExists(t, filepath.Join(projectDir, "src", "untitled-directory-1"))
}

func TestCreateContentSaysWhenItCouldNotCreateAnything(t *testing.T) {
	project, projectDir := testProject(t)

	for _, contentType := range []string{"file", "notebook", "directory"} {
		t.Run(contentType, func(t *testing.T) {
			// A parent directory that is not there is the everyday version of this: the folder was
			// deleted in another window while its row was still on screen.
			_, err := project.createContent(ContentPayload{ParentDir: "gone", ContentType: contentType})
			assert.ErrorIs(t, err, os.ErrNotExist)

			// Outside the project is the other: it used to be written to the server's own working
			// directory, because the safe path answered "" and a relative path was joined onto it.
			_, err = project.createContent(ContentPayload{ParentDir: "../elsewhere", ContentType: contentType})
			assert.Error(t, err)
		})
	}

	entries, err := os.ReadDir(filepath.Dir(projectDir))
	assert.NoError(t, err)
	for _, entry := range entries {
		assert.NotContains(t, entry.Name(), "ntitled", "nothing should be created outside the project")
	}
}

func TestCreateContentAnswersWithWhatIsOnDisk(t *testing.T) {
	project, projectDir := testProject(t)

	notebook, err := project.createContent(ContentPayload{ParentDir: "", ContentType: "notebook"})
	assert.NoError(t, err)
	assert.Equal(t, "Untitled.ipynb", notebook.Name)
	// Empty until now: a size and a date the client can show have to come from the file.
	assert.Greater(t, notebook.Size, int64(0))
	assert.NotEmpty(t, notebook.LastModified)

	written, err := os.ReadFile(filepath.Join(projectDir, "Untitled.ipynb"))
	assert.NoError(t, err)
	assert.Contains(t, string(written), `"nbformat"`)

	// And the second one is beside it rather than on top of it.
	second, err := project.createContent(ContentPayload{ParentDir: "", ContentType: "notebook"})
	assert.NoError(t, err)
	assert.Equal(t, "Untitled1.ipynb", second.Name)
}

func TestMoveContentCarriesAFolderToAnotherFolder(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "src", "inner"), 0o755))
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "lib"), 0o755))
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "src", "inner", "a.txt"), []byte("a"), 0o644))

	assert.NoError(t, project.moveContent("src/inner", "lib/inner"))

	assert.FileExists(t, filepath.Join(projectDir, "lib", "inner", "a.txt"))
	assert.NoDirExists(t, filepath.Join(projectDir, "src", "inner"))
}

func TestMoveContentRefusesWhatWouldLoseSomething(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "src"), 0o755))
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "keep.txt"), []byte("keep"), 0o644))
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "notes.txt"), []byte("notes"), 0o644))

	assert.ErrorIs(t, project.moveContent("notes.txt", "keep.txt"), errTargetExists)
	assert.ErrorIs(t, project.moveContent("missing.txt", "src/missing.txt"), os.ErrNotExist)
	assert.ErrorIs(t, project.moveContent("src", "src/inner"), errIntoItself)
	assert.Error(t, project.moveContent("notes.txt", "gone/notes.txt"), "there is no folder to move into")
	assert.Error(t, project.moveContent("notes.txt", "../escaped.txt"))
	assert.NoFileExists(t, filepath.Join(filepath.Dir(projectDir), "escaped.txt"))

	kept, err := os.ReadFile(filepath.Join(projectDir, "keep.txt"))
	assert.NoError(t, err)
	assert.Equal(t, "keep", string(kept))
}

func TestCopyContentDuplicatesAFileInPlace(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "notes.txt"), []byte("hello"), 0o644))

	first, err := project.copyContent("notes.txt", "")
	assert.NoError(t, err)
	assert.Equal(t, "notes-Copy1.txt", first.Name, "the copy is named the way Jupyter names one")
	assert.Equal(t, "notes-Copy1.txt", first.Path)
	assert.Equal(t, "file", first.ContentType)

	copied, err := os.ReadFile(filepath.Join(projectDir, "notes-Copy1.txt"))
	assert.NoError(t, err)
	assert.Equal(t, "hello", string(copied))

	// Duplicating again does not land on the first copy.
	second, err := project.copyContent("notes.txt", "")
	assert.NoError(t, err)
	assert.Equal(t, "notes-Copy2.txt", second.Name)
	assert.FileExists(t, filepath.Join(projectDir, "notes.txt"), "the original stays where it is")
}

func TestCopyContentCopiesAWholeTreeIntoAnotherFolder(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "src", "inner"), 0o755))
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "lib"), 0o755))
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "src", "inner", "a.txt"), []byte("a"), 0o644))

	model, err := project.copyContent("src", "lib")

	assert.NoError(t, err)
	assert.Equal(t, "src", model.Name, "nothing in lib was called src, so the copy keeps the name")
	assert.Equal(t, filepath.Join("lib", "src"), model.Path)
	assert.Equal(t, "directory", model.ContentType)
	assert.FileExists(t, filepath.Join(projectDir, "lib", "src", "inner", "a.txt"))
	assert.DirExists(t, filepath.Join(projectDir, "src", "inner"))

	// A second copy cannot have it, and a folder's name is not split on its dots.
	again, err := project.copyContent("src", "lib")
	assert.NoError(t, err)
	assert.Equal(t, "src-Copy1", again.Name)
}

func TestCopyContentRefusesAFolderIntoItself(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "src", "inner"), 0o755))

	// Left to itself, filepath.Walk would keep finding the copy it is making.
	_, err := project.copyContent("src", "src/inner")

	assert.ErrorIs(t, err, errIntoItself)
	assert.NoDirExists(t, filepath.Join(projectDir, "src", "inner", "src"))
}

func TestCopyContentKeepsALinkAsALink(t *testing.T) {
	project, projectDir := testProject(t)
	outside := filepath.Join(filepath.Dir(projectDir), "secret.txt")
	assert.NoError(t, os.WriteFile(outside, []byte("secret"), 0o644))
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "src"), 0o755))
	assert.NoError(t, os.Symlink(outside, filepath.Join(projectDir, "src", "link.txt")))

	_, err := project.copyContent("src", "")
	assert.NoError(t, err)

	// Following the link would copy something from outside the project into it.
	info, err := os.Lstat(filepath.Join(projectDir, "src-Copy1", "link.txt"))
	assert.NoError(t, err)
	assert.NotZero(t, info.Mode()&os.ModeSymlink, "the copy should still be a link")
}

func TestUploadContentWritesTheFileAndDescribesIt(t *testing.T) {
	project, projectDir := testProject(t)
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "docs"), 0o755))

	model, err := project.uploadContent("docs", "notes.txt", false, strings.NewReader("hello"))

	assert.NoError(t, err)
	assert.Equal(t, "notes.txt", model.Name)
	assert.Equal(t, filepath.Join("docs", "notes.txt"), model.Path)
	assert.Equal(t, "file", model.ContentType)
	written, readErr := os.ReadFile(filepath.Join(projectDir, "docs", "notes.txt"))
	assert.NoError(t, readErr)
	assert.Equal(t, "hello", string(written))
}

func TestUploadContentAnswersWithAPathTheBrowserCanUse(t *testing.T) {
	project, _ := testProject(t)

	model, err := project.uploadContent("", "notes.txt", false, strings.NewReader("hello"))

	assert.NoError(t, err)
	// Not "./notes.txt": the file browser keys its rows on this string.
	assert.Equal(t, "notes.txt", model.Path)
}

func TestUploadContentMakesTheFoldersAFolderUploadNeeds(t *testing.T) {
	project, projectDir := testProject(t)

	model, err := project.uploadContent("", "notes/img/logo.png", false, strings.NewReader("png"))

	assert.NoError(t, err)
	assert.Equal(t, "logo.png", model.Name)
	assert.Equal(t, filepath.Join("notes", "img", "logo.png"), model.Path)
	assert.FileExists(t, filepath.Join(projectDir, "notes", "img", "logo.png"))
}

func TestUploadContentRefusesToOverwriteUnlessAsked(t *testing.T) {
	project, projectDir := testProject(t)
	target := filepath.Join(projectDir, "notes.txt")
	assert.NoError(t, os.WriteFile(target, []byte("keep"), 0o644))

	_, err := project.uploadContent("", "notes.txt", false, strings.NewReader("new"))

	assert.ErrorIs(t, err, errTargetExists)
	kept, readErr := os.ReadFile(target)
	assert.NoError(t, readErr)
	assert.Equal(t, "keep", string(kept))

	_, err = project.uploadContent("", "notes.txt", true, strings.NewReader("new"))
	assert.NoError(t, err)
	replaced, readErr := os.ReadFile(target)
	assert.NoError(t, readErr)
	assert.Equal(t, "new", string(replaced))
}

func TestUploadContentLeavesNothingBehindWhenTheBodyBreaks(t *testing.T) {
	project, projectDir := testProject(t)

	_, err := project.uploadContent("", "notes.txt", false, iotest.TimeoutReader(strings.NewReader("hello")))

	assert.Error(t, err)
	assert.NoFileExists(t, filepath.Join(projectDir, "notes.txt"))
	// Not even the temporary file the bytes were going into.
	entries, readErr := os.ReadDir(projectDir)
	assert.NoError(t, readErr)
	assert.Empty(t, entries)
}

func TestUploadContentRefusesToClimbOutOfTheProject(t *testing.T) {
	project, projectDir := testProject(t)

	_, err := project.uploadContent("", "../escaped.txt", false, strings.NewReader("hello"))

	assert.Error(t, err)
	assert.NoFileExists(t, filepath.Join(filepath.Dir(projectDir), "escaped.txt"))
}

func TestUploadContentRefusesSomethingThatIsNotAFileName(t *testing.T) {
	project, _ := testProject(t)

	for _, name := range []string{"", ".", "..", "/", "src/"} {
		_, err := project.uploadContent("", name, false, strings.NewReader("hello"))
		assert.Error(t, err, "%q is not a file name", name)
	}
}

func TestCreatedModelSaysWhetherItCanBeWritten(t *testing.T) {
	project, _ := testProject(t)

	model, err := project.uploadContent("", "notes.txt", false, strings.NewReader("hello"))

	assert.NoError(t, err)
	// A directory listing reports this, and a row would otherwise be marked read-only until the next
	// time the folder was read.
	assert.True(t, model.Writable)
}
