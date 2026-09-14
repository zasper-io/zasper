package session

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/kernelspec"
	"github.com/zasper-io/zasper/internal/models"
)

// testSessions answers sessions for a project of its own with no kernels running, and runs the test in
// parallel.
func testSessions(t *testing.T) *Sessions {
	t.Helper()
	t.Parallel()

	return New(content.NewProject(t.TempDir()), kernel.New(kernelspec.NewCatalog(nil, "")))
}

// sessionsFor answers sessions on the given paths, with ids a, b, c and so on.
func sessionsFor(t *testing.T, paths ...string) *Sessions {
	t.Helper()

	s := testSessions(t)
	for i, path := range paths {
		id := string(rune('a' + i))
		s.set(id, models.SessionModel{Id: id, Name: filepath.Base(path), Path: path})
	}
	return s
}

// stored answers with the session under an id, which has to be there for the assertion to mean anything.
func stored(t *testing.T, s *Sessions, id string) models.SessionModel {
	t.Helper()

	session, ok := s.Get(id)
	assert.True(t, ok, "no session %s", id)
	return session
}

func TestAKernelIsPlacedInItsNotebooksFolder(t *testing.T) {
	t.Parallel()
	project := t.TempDir()
	s := New(content.NewProject(project), nil)
	require.NoError(t, os.MkdirAll(filepath.Join(project, "analysis"), 0o755))

	dir, env := s.kernelPlacement("analysis/notes.ipynb")
	assert.Equal(t, filepath.Join(project, "analysis"), dir)
	assert.Equal(t, filepath.Join(project, "analysis", "notes.ipynb"), env["JPY_SESSION_NAME"])

	// Anything that names no folder inside the project starts at the root instead.
	for _, path := range []string{"", ".", "../elsewhere.ipynb", "missing/notes.ipynb"} {
		dir, _ := s.kernelPlacement(path)
		assert.Equal(t, project, dir, "path %q", path)
	}
}

// running registers a session on a path and a kernel, as Create would have.
func running(s *Sessions, id, path, kernelName string) models.SessionModel {
	session := models.SessionModel{
		Id:     id,
		Name:   filepath.Base(path),
		Path:   path,
		Kernel: models.KernelModel{Id: id + "-kernel", Name: kernelName},
	}
	s.set(id, session)
	return session
}

func TestARequestNamingASessionJoinsIt(t *testing.T) {
	s := sessionsFor(t)
	session := running(s, "a", "notes.ipynb", "python3")

	// By id, which is the one case that says nothing about paths or kernels.
	found, ok := s.runningSessionFor(models.SessionModel{Id: "a"})
	require.True(t, ok)
	assert.Equal(t, session, found)
}

func TestARequestForADifferentKernelStartsItsOwnSession(t *testing.T) {
	s := sessionsFor(t)
	running(s, "a", "notes.ipynb", "python3")

	// Switching a notebook's kernel is asking for a different kernel, not for the one already there.
	_, ok := s.runningSessionFor(models.SessionModel{Path: "notes.ipynb", Kernel: models.KernelModel{Name: "julia"}})
	assert.False(t, ok)
	// And the session that is there is left alone: it is still running.
	_, still := s.Get("a")
	assert.True(t, still)
}

// A session whose kernel died is not one to join, and not one to leave behind either: it would shadow
// the session about to be started on the same notebook.
func TestASessionThatOutlivedItsKernelIsDropped(t *testing.T) {
	s := sessionsFor(t)
	running(s, "a", "notes.ipynb", "python3")

	_, ok := s.runningSessionFor(models.SessionModel{Path: "notes.ipynb", Kernel: models.KernelModel{Name: "python3"}})
	assert.False(t, ok)

	_, still := s.Get("a")
	assert.False(t, still, "the stale session should have been dropped")
}

func TestRelocateFollowsARenamedNotebook(t *testing.T) {
	s := sessionsFor(t, "notes.ipynb", "notes2.ipynb")

	assert.Equal(t, 1, s.Relocate("notes.ipynb", "renamed.ipynb"))

	assert.Equal(t, "renamed.ipynb", stored(t, s, "a").Path)
	// By path segments rather than by prefix: notes2 is not inside notes.
	assert.Equal(t, "notes2.ipynb", stored(t, s, "b").Path)
}

func TestRelocateFollowsEveryNotebookUnderAMovedFolder(t *testing.T) {
	s := sessionsFor(t, "src/a.ipynb", "src/deep/b.ipynb", "srcx/c.ipynb")

	assert.Equal(t, 2, s.Relocate("src", "lib/src"))

	assert.Equal(t, "lib/src/a.ipynb", stored(t, s, "a").Path)
	assert.Equal(t, "lib/src/deep/b.ipynb", stored(t, s, "b").Path)
	assert.Equal(t, "srcx/c.ipynb", stored(t, s, "c").Path)
}

func TestRelocateRenamesTheSessionWithTheFile(t *testing.T) {
	s := sessionsFor(t)
	s.set("a", models.SessionModel{Id: "a", Name: "notes.ipynb", Path: "src/notes.ipynb"})
	// A session named something of its own keeps that name; only one that was named after the file
	// follows it.
	s.set("b", models.SessionModel{Id: "b", Name: "my analysis", Path: "src/other.ipynb"})

	s.Relocate("src/notes.ipynb", "src/renamed.ipynb")
	s.Relocate("src/other.ipynb", "src/moved.ipynb")

	assert.Equal(t, "renamed.ipynb", stored(t, s, "a").Name)
	assert.Equal(t, "my analysis", stored(t, s, "b").Name)
	assert.Equal(t, "src/moved.ipynb", stored(t, s, "b").Path)
}

func TestRelocateLeavesUnrelatedSessionsAlone(t *testing.T) {
	s := sessionsFor(t, "a.ipynb")

	assert.Equal(t, 0, s.Relocate("b.ipynb", "c.ipynb"))
	assert.Equal(t, "a.ipynb", stored(t, s, "a").Path)
}
