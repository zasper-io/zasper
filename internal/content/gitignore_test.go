package content

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zasper-io/zasper/internal/models"
)

// ignoredNames is the listing as the file browser sees it: which rows would be dimmed.
func ignoredNames(t *testing.T, relativePath string) map[string]bool {
	t.Helper()

	model, err := getDirectoryModel(relativePath)
	assert.NoError(t, err)

	ignored := map[string]bool{}
	for _, entry := range model.Content.([]models.ContentModel) {
		ignored[entry.Name] = entry.Ignored
	}
	return ignored
}

func TestListingMarksWhatGitWouldNotTrack(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, ".gitignore"),
		[]byte("# build output\nnode_modules/\n*.log\n!keep.log\n"), 0o644))
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "node_modules"), 0o755))
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "src"), 0o755))
	for _, name := range []string{"debug.log", "keep.log", "main.py"} {
		assert.NoError(t, os.WriteFile(filepath.Join(projectDir, name), []byte(""), 0o644))
	}

	ignored := ignoredNames(t, "")

	assert.True(t, ignored["node_modules"])
	assert.True(t, ignored["debug.log"])
	assert.False(t, ignored["keep.log"], "a negated pattern is not ignored")
	assert.False(t, ignored["main.py"])
	assert.False(t, ignored["src"])
}

func TestListingAppliesAParentFolderPatternsButNotASiblings(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "src"), 0o755))
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "other"), 0o755))
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, ".gitignore"), []byte("*.log\n"), 0o644))
	// A pattern rooted in the sibling folder, which must not reach into src.
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "other", ".gitignore"), []byte("/secret.py\n"), 0o644))
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "src", "debug.log"), []byte(""), 0o644))
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "src", "secret.py"), []byte(""), 0o644))

	ignored := ignoredNames(t, "src")

	assert.True(t, ignored["debug.log"], "the project root's patterns reach every folder")
	assert.False(t, ignored["secret.py"], "another folder's .gitignore does not")
}

func TestEverythingInsideAnIgnoredFolderIsIgnored(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, ".gitignore"), []byte("node_modules/\n"), 0o644))
	assert.NoError(t, os.MkdirAll(filepath.Join(projectDir, "node_modules", "react"), 0o755))
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "node_modules", "index.js"), []byte(""), 0o644))

	ignored := ignoredNames(t, "node_modules")

	// Nothing here matches `node_modules/` by name; they are ignored because of where they are.
	assert.True(t, ignored["index.js"])
	assert.True(t, ignored["react"])
}

func TestListingIsUnbotheredByAProjectWithoutGitignore(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "main.py"), []byte(""), 0o644))

	ignored := ignoredNames(t, "")

	assert.False(t, ignored["main.py"])
}

func TestListingSaysWhetherAnEntryCanBeWritten(t *testing.T) {
	projectDir := projectDirElsewhere(t)
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "editable.txt"), []byte(""), 0o644))
	assert.NoError(t, os.WriteFile(filepath.Join(projectDir, "locked.txt"), []byte(""), 0o444))

	model, err := getDirectoryModel("")
	assert.NoError(t, err)

	writable := map[string]bool{}
	for _, entry := range model.Content.([]models.ContentModel) {
		writable[entry.Name] = entry.Writable
	}

	// Always false until now, so a read-only marker would have marked everything.
	assert.True(t, writable["editable.txt"])
	if os.Geteuid() != 0 {
		assert.False(t, writable["locked.txt"], "root may write anything, and CI sometimes is root")
	}
}

func TestPathSegments(t *testing.T) {
	assert.Nil(t, pathSegments(""), "the project root is no segments at all")
	assert.Nil(t, pathSegments("."))
	assert.Equal(t, []string{"src"}, pathSegments("src"))
	assert.Equal(t, []string{"src", "ide"}, pathSegments("src/ide"))
	assert.Equal(t, []string{"src", "ide"}, pathSegments("/src/ide/"))
}
