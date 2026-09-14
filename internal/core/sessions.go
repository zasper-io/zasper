package core

import (
	"github.com/zasper-io/zasper/internal/models"
	"github.com/zasper-io/zasper/internal/store"
)

// sessions are the running sessions, by id.
var sessions store.Map[string, models.SessionModel]

// SetUpActiveSessions empties the store, for a server that is starting up.
func SetUpActiveSessions() {
	sessions.Clear()
}

// ListSessions answers with a copy, which the caller may walk while something else starts a kernel.
func ListSessions() map[string]models.SessionModel {
	return sessions.Snapshot()
}

func GetSession(sessionId string) (models.SessionModel, bool) {
	return sessions.Get(sessionId)
}

/*
SessionForPath answers a session running the file at path on the kernel named, an empty kernelName
matching any. It is how a reloaded page or a second tab finds the notebook's kernel instead of starting
another; the kernel is part of the question because switching kernels asks for a different one.
*/
func SessionForPath(path, kernelName string) (models.SessionModel, bool) {
	for _, session := range sessions.Values() {
		if session.Path == path && (kernelName == "" || session.Kernel.Name == kernelName) {
			return session, true
		}
	}
	return models.SessionModel{}, false
}

func SetSession(sessionId string, session models.SessionModel) {
	sessions.Set(sessionId, session)
}

// RemoveSession takes a session out and reports whether this call took it, so that two deletes of the
// same session do not both stop its kernel.
func RemoveSession(sessionId string) (models.SessionModel, bool) {
	return sessions.Take(sessionId)
}

// UpdateSessions rewrites, under one lock, the sessions update answers a replacement for, and returns how
// many changed.
func UpdateSessions(update func(models.SessionModel) (models.SessionModel, bool)) int {
	changed := 0
	sessions.With(func(all map[string]models.SessionModel) {
		for id, session := range all {
			if updated, ok := update(session); ok {
				all[id] = updated
				changed++
			}
		}
	})
	return changed
}

// DeleteSessionsForKernel drops every session on the kernel and returns their ids, for a kernel killed
// without going through its session.
func DeleteSessionsForKernel(kernelId string) []string {
	deleted := []string{}
	sessions.With(func(all map[string]models.SessionModel) {
		for id, session := range all {
			if session.Kernel.Id == kernelId {
				delete(all, id)
				deleted = append(deleted, id)
			}
		}
	})
	return deleted
}
