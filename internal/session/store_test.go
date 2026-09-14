package session

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zasper-io/zasper/internal/models"
)

func withSessions(t *testing.T, given ...models.SessionModel) *Sessions {
	t.Helper()

	s := testSessions(t)
	for _, session := range given {
		s.set(session.Id, session)
	}
	return s
}

func sessionOn(id, path, kernelId string) models.SessionModel {
	return models.SessionModel{Id: id, Name: path, Path: path, Kernel: models.KernelModel{Id: kernelId}}
}

func TestSessionsAreFoundByIdAndOnlyById(t *testing.T) {
	s := withSessions(t, sessionOn("a", "notes.ipynb", "k1"))

	found, ok := s.Get("a")
	assert.True(t, ok)
	assert.Equal(t, "notes.ipynb", found.Path)

	_, ok = s.Get("nope")
	assert.False(t, ok)
}

func TestListAnswersWithACopy(t *testing.T) {
	s := withSessions(t, sessionOn("a", "notes.ipynb", "k1"))

	listed := s.List()
	delete(listed, "a")
	listed["b"] = sessionOn("b", "other.ipynb", "k2")

	// The point of the copy: a handler is free to walk what it was given, and to be slow about it,
	// without holding the store still or being able to change it by accident.
	_, ok := s.Get("a")
	assert.True(t, ok)
	_, ok = s.Get("b")
	assert.False(t, ok)
}

func TestRemovingASessionOnlyAnswersOnceForTheSameSession(t *testing.T) {
	s := withSessions(t, sessionOn("a", "notes.ipynb", "k1"))

	removed, ok := s.remove("a")
	assert.True(t, ok)
	assert.Equal(t, "k1", removed.Kernel.Id)

	// What stops two requests deleting the same session from both stopping its kernel.
	_, ok = s.remove("a")
	assert.False(t, ok)
}

func TestUpdateRewritesOnlyWhatItIsAnsweredFor(t *testing.T) {
	s := withSessions(t, sessionOn("a", "notes.ipynb", "k1"), sessionOn("b", "other.ipynb", "k2"))

	changed := s.update(func(session models.SessionModel) (models.SessionModel, bool) {
		if session.Id != "a" {
			return session, false
		}
		session.Path = "renamed.ipynb"
		return session, true
	})

	assert.Equal(t, 1, changed)
	assert.Equal(t, "renamed.ipynb", mustGet(t, s, "a").Path)
	assert.Equal(t, "other.ipynb", mustGet(t, s, "b").Path)
}

func TestDeleteForKernelDropsEverySessionOnIt(t *testing.T) {
	s := withSessions(t,
		sessionOn("a", "notes.ipynb", "k1"),
		sessionOn("b", "other.ipynb", "k1"),
		sessionOn("c", "third.ipynb", "k2"),
	)

	assert.ElementsMatch(t, []string{"a", "b"}, s.DeleteForKernel("k1"))

	assert.Equal(t, []string{"c"}, keys(s.List()))
}

// The session handlers, the kernel socket and the hook that follows a renamed notebook all reach the
// store at once; -race is what this relies on.
func TestTheStoreHoldsUpWhenEverythingReachesItAtOnce(t *testing.T) {
	s := withSessions(t)

	const workers = 8
	const each = 200
	var running sync.WaitGroup

	for worker := 0; worker < workers; worker++ {
		running.Add(1)
		go func(worker int) {
			defer running.Done()
			for i := 0; i < each; i++ {
				id := fmt.Sprintf("%d-%d", worker, i)
				s.set(id, sessionOn(id, "notes.ipynb", fmt.Sprintf("k%d", worker)))
				s.Get(id)
				s.List()
				s.update(func(session models.SessionModel) (models.SessionModel, bool) {
					return session, false
				})
				if i%3 == 0 {
					s.remove(id)
				}
				if i%50 == 0 {
					s.DeleteForKernel(fmt.Sprintf("k%d", worker))
				}
			}
		}(worker)
	}

	running.Wait()
	assert.NotNil(t, s.List())
}

func mustGet(t *testing.T, s *Sessions, id string) models.SessionModel {
	t.Helper()

	session, ok := s.Get(id)
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
