package session

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

// running registers a session on a path and a kernel, as CreateSession would have.
func running(id, path, kernelName string) models.SessionModel {
	session := models.SessionModel{
		Id:     id,
		Name:   filepath.Base(path),
		Path:   path,
		Kernel: models.KernelModel{Id: id + "-kernel", Name: kernelName},
	}
	core.SetSession(id, session)
	return session
}

func TestARequestNamingASessionJoinsIt(t *testing.T) {
	sessionsFor(t)
	session := running("a", "notes.ipynb", "python3")

	// By id, which is the one case that says nothing about paths or kernels.
	found, ok := runningSessionFor(models.SessionModel{Id: "a"})
	require.True(t, ok)
	assert.Equal(t, session, found)
}

func TestARequestForADifferentKernelStartsItsOwnSession(t *testing.T) {
	sessionsFor(t)
	running("a", "notes.ipynb", "python3")

	// Switching a notebook's kernel is asking for a different kernel, not for the one already there.
	_, ok := runningSessionFor(models.SessionModel{Path: "notes.ipynb", Kernel: models.KernelModel{Name: "julia"}})
	assert.False(t, ok)
	// And the session that is there is left alone: it is still running.
	_, still := core.GetSession("a")
	assert.True(t, still)
}

// A session whose kernel died is not one to join, and not one to leave behind either: it would shadow
// the session about to be started on the same notebook.
func TestASessionThatOutlivedItsKernelIsDropped(t *testing.T) {
	sessionsFor(t)
	running("a", "notes.ipynb", "python3")

	_, ok := runningSessionFor(models.SessionModel{Path: "notes.ipynb", Kernel: models.KernelModel{Name: "python3"}})
	assert.False(t, ok)

	_, still := core.GetSession("a")
	assert.False(t, still, "the stale session should have been dropped")
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
