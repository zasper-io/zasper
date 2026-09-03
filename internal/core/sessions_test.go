package core

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zasper-io/zasper/internal/models"
)

func withSessions(t *testing.T, given ...models.SessionModel) {
	t.Helper()

	// One store per process, so a test that left its sessions behind would be the next one's starting
	// point.
	t.Cleanup(SetUpActiveSessions)

	SetUpActiveSessions()
	for _, session := range given {
		SetSession(session.Id, session)
	}
}

func sessionOn(id, path, kernelId string) models.SessionModel {
	return models.SessionModel{Id: id, Name: path, Path: path, Kernel: models.KernelModel{Id: kernelId}}
}

func TestSessionsAreFoundByIdAndOnlyById(t *testing.T) {
	withSessions(t, sessionOn("a", "notes.ipynb", "k1"))

	found, ok := GetSession("a")
	assert.True(t, ok)
	assert.Equal(t, "notes.ipynb", found.Path)

	_, ok = GetSession("nope")
	assert.False(t, ok)
}

func TestSetUpActiveSessionsEmptiesTheStore(t *testing.T) {
	withSessions(t, sessionOn("a", "notes.ipynb", "k1"))

	SetUpActiveSessions()

	assert.Empty(t, ListSessions())
}

func TestListSessionsAnswersWithACopy(t *testing.T) {
	withSessions(t, sessionOn("a", "notes.ipynb", "k1"))

	listed := ListSessions()
	delete(listed, "a")
	listed["b"] = sessionOn("b", "other.ipynb", "k2")

	// The point of the copy: a handler is free to walk what it was given, and to be slow about it,
	// without holding the store still or being able to change it by accident.
	_, ok := GetSession("a")
	assert.True(t, ok)
	_, ok = GetSession("b")
	assert.False(t, ok)
}

func TestRemoveSessionOnlyAnswersOnceForTheSameSession(t *testing.T) {
	withSessions(t, sessionOn("a", "notes.ipynb", "k1"))

	removed, ok := RemoveSession("a")
	assert.True(t, ok)
	assert.Equal(t, "k1", removed.Kernel.Id)

	// What stops two requests deleting the same session from both stopping its kernel.
	_, ok = RemoveSession("a")
	assert.False(t, ok)
}

func TestUpdateSessionsRewritesOnlyWhatItIsAnsweredFor(t *testing.T) {
	withSessions(t, sessionOn("a", "notes.ipynb", "k1"), sessionOn("b", "other.ipynb", "k2"))

	changed := UpdateSessions(func(session models.SessionModel) (models.SessionModel, bool) {
		if session.Id != "a" {
			return session, false
		}
		session.Path = "renamed.ipynb"
		return session, true
	})

	assert.Equal(t, 1, changed)
	assert.Equal(t, "renamed.ipynb", mustGet(t, "a").Path)
	assert.Equal(t, "other.ipynb", mustGet(t, "b").Path)
}

func TestDeleteSessionsForKernelDropsEverySessionOnIt(t *testing.T) {
	withSessions(t,
		sessionOn("a", "notes.ipynb", "k1"),
		sessionOn("b", "other.ipynb", "k1"),
		sessionOn("c", "third.ipynb", "k2"),
	)

	assert.ElementsMatch(t, []string{"a", "b"}, DeleteSessionsForKernel("k1"))

	assert.Equal(t, []string{"c"}, keys(ListSessions()))
}

/*
Everything at once, which is the whole reason the store has a lock.

Sessions used to be an exported map written directly by the session handlers, the kernel socket and
the hook that follows a renamed notebook. Two of those at the same time is not a lost update but a
dead server: Go's answer to a concurrent map write is to kill the process. This test panics against
that version of the code, and reports a data race under `go test -race`.
*/
func TestTheStoreHoldsUpWhenEverythingReachesItAtOnce(t *testing.T) {
	withSessions(t)

	const workers = 8
	const each = 200
	var running sync.WaitGroup

	for worker := 0; worker < workers; worker++ {
		running.Add(1)
		go func(worker int) {
			defer running.Done()
			for i := 0; i < each; i++ {
				id := fmt.Sprintf("%d-%d", worker, i)
				SetSession(id, sessionOn(id, "notes.ipynb", fmt.Sprintf("k%d", worker)))
				GetSession(id)
				ListSessions()
				UpdateSessions(func(session models.SessionModel) (models.SessionModel, bool) {
					return session, false
				})
				if i%3 == 0 {
					RemoveSession(id)
				}
				if i%50 == 0 {
					DeleteSessionsForKernel(fmt.Sprintf("k%d", worker))
				}
			}
		}(worker)
	}

	running.Wait()
	// Nothing to assert beyond having got here: the failure this is about takes the process with it.
	assert.NotNil(t, ListSessions())
}

func mustGet(t *testing.T, id string) models.SessionModel {
	t.Helper()

	session, ok := GetSession(id)
	assert.True(t, ok, "no session %s", id)
	return session
}

func keys(sessions map[string]models.SessionModel) []string {
	ids := make([]string, 0, len(sessions))
	for id := range sessions {
		ids = append(ids, id)
	}
	return ids
}
