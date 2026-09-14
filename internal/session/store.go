package session

import (
	"sync"

	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/models"
	"github.com/zasper-io/zasper/internal/store"
)

// Sessions are a server's notebook sessions, each on a kernel of its own.
type Sessions struct {
	project content.Project
	kernels *kernel.Kernels
	running store.Map[string, models.SessionModel]
	// Per notebook rather than one lock for all: starting a kernel takes seconds, and opening a different
	// notebook should not wait for it.
	pathLocks pathLocks
}

type pathLocks struct {
	mu   sync.Mutex
	held map[string]*pathLock
}

type pathLock struct {
	sync.Mutex
	users int
}

// New keeps the sessions of project, and starts their kernels with kernels.
func New(project content.Project, kernels *kernel.Kernels) *Sessions {
	return &Sessions{project: project, kernels: kernels, pathLocks: pathLocks{held: map[string]*pathLock{}}}
}

// Get answers a running session.
func (s *Sessions) Get(sessionId string) (models.SessionModel, bool) {
	return s.running.Get(sessionId)
}

// List answers a copy of every running session, by id.
func (s *Sessions) List() map[string]models.SessionModel {
	return s.running.Snapshot()
}

/*
forPath answers a session running the file at path on the kernel named, an empty kernelName matching
any. It is how a reloaded page or a second tab finds the notebook's kernel instead of starting another;
the kernel is part of the question because switching kernels asks for a different one.
*/
func (s *Sessions) forPath(path, kernelName string) (models.SessionModel, bool) {
	for _, session := range s.running.Values() {
		if session.Path == path && (kernelName == "" || session.Kernel.Name == kernelName) {
			return session, true
		}
	}
	return models.SessionModel{}, false
}

func (s *Sessions) set(sessionId string, session models.SessionModel) {
	s.running.Set(sessionId, session)
}

// remove takes a session out and reports whether this call took it, so that two deletes of the same
// session do not both stop its kernel.
func (s *Sessions) remove(sessionId string) (models.SessionModel, bool) {
	return s.running.Take(sessionId)
}

// update rewrites, under one lock, the sessions change answers a replacement for, and returns how many
// changed.
func (s *Sessions) update(change func(models.SessionModel) (models.SessionModel, bool)) int {
	changed := 0
	s.running.With(func(all map[string]models.SessionModel) {
		for id, session := range all {
			if updated, ok := change(session); ok {
				all[id] = updated
				changed++
			}
		}
	})
	return changed
}

// DeleteForKernel drops every session on the kernel and returns their ids, for a kernel stopped without
// going through its session.
func (s *Sessions) DeleteForKernel(kernelId string) []string {
	deleted := []string{}
	s.running.With(func(all map[string]models.SessionModel) {
		for id, session := range all {
			if session.Kernel.Id == kernelId {
				delete(all, id)
				deleted = append(deleted, id)
			}
		}
	})
	return deleted
}
