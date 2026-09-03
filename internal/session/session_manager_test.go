package session

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/models"
)

func sessionsFor(t *testing.T, paths ...string) {
	t.Helper()

	// The store is one per process, so a test that left its sessions behind would be the next one's
	// starting point.
	t.Cleanup(core.SetUpActiveSessions)

	core.SetUpActiveSessions()
	for i, path := range paths {
		id := string(rune('a' + i))
		core.SetSession(id, models.SessionModel{Id: id, Name: filepath.Base(path), Path: path})
	}
}

// stored answers with the session under an id, which has to be there for the assertion to mean
// anything.
func stored(t *testing.T, id string) models.SessionModel {
	t.Helper()

	session, ok := core.GetSession(id)
	assert.True(t, ok, "no session %s", id)
	return session
}

func TestRelocateSessionsFollowsARenamedNotebook(t *testing.T) {
	sessionsFor(t, "notes.ipynb", "notes2.ipynb")

	assert.Equal(t, 1, RelocateSessions("notes.ipynb", "renamed.ipynb"))

	assert.Equal(t, "renamed.ipynb", stored(t, "a").Path)
	// By path segments rather than by prefix: notes2 is not inside notes.
	assert.Equal(t, "notes2.ipynb", stored(t, "b").Path)
}

func TestRelocateSessionsFollowsEveryNotebookUnderAMovedFolder(t *testing.T) {
	sessionsFor(t, "src/a.ipynb", "src/deep/b.ipynb", "srcx/c.ipynb")

	assert.Equal(t, 2, RelocateSessions("src", "lib/src"))

	assert.Equal(t, "lib/src/a.ipynb", stored(t, "a").Path)
	assert.Equal(t, "lib/src/deep/b.ipynb", stored(t, "b").Path)
	assert.Equal(t, "srcx/c.ipynb", stored(t, "c").Path)
}

func TestRelocateSessionsRenamesTheSessionWithTheFile(t *testing.T) {
	sessionsFor(t)
	core.SetSession("a", models.SessionModel{Id: "a", Name: "notes.ipynb", Path: "src/notes.ipynb"})
	// A session named something of its own keeps that name; only one that was named after the file
	// follows it.
	core.SetSession("b", models.SessionModel{Id: "b", Name: "my analysis", Path: "src/other.ipynb"})

	RelocateSessions("src/notes.ipynb", "src/renamed.ipynb")
	RelocateSessions("src/other.ipynb", "src/moved.ipynb")

	assert.Equal(t, "renamed.ipynb", stored(t, "a").Name)
	assert.Equal(t, "my analysis", stored(t, "b").Name)
	assert.Equal(t, "src/moved.ipynb", stored(t, "b").Path)
}

func TestRelocateSessionsLeavesUnrelatedSessionsAlone(t *testing.T) {
	sessionsFor(t, "a.ipynb")

	assert.Equal(t, 0, RelocateSessions("b.ipynb", "c.ipynb"))
	assert.Equal(t, "a.ipynb", stored(t, "a").Path)
}
