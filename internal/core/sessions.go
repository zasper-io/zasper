package core

import (
	"sync"

	"github.com/zasper-io/zasper/internal/models"
)

/*
The running sessions.

Held behind a lock rather than exported as a map. Every request runs on its own goroutine, and the
kernel socket and the hook that follows a renamed notebook reach these as well, so three of them can
be here at once — and Go answers a concurrent map write by killing the process, not the request. The
map is unexported so that the lock cannot be forgotten at a call site.
*/
var sessions = struct {
	mu sync.RWMutex
	by map[string]models.SessionModel
}{by: map[string]models.SessionModel{}}

// SetUpActiveSessions empties the store, for a server that is starting up.
func SetUpActiveSessions() {
	sessions.mu.Lock()
	defer sessions.mu.Unlock()

	sessions.by = map[string]models.SessionModel{}
}

// ListSessions answers with a copy: the caller is free to walk it, and to be slow about it, while
// something else starts a kernel.
func ListSessions() map[string]models.SessionModel {
	sessions.mu.RLock()
	defer sessions.mu.RUnlock()

	all := make(map[string]models.SessionModel, len(sessions.by))
	for id, session := range sessions.by {
		all[id] = session
	}
	return all
}

func GetSession(sessionId string) (models.SessionModel, bool) {
	sessions.mu.RLock()
	defer sessions.mu.RUnlock()

	session, ok := sessions.by[sessionId]
	return session, ok
}

/*
SessionForPath answers with a session running the file at path, and on the kernel named — an empty
kernelName matching whichever kernel it is on.

This is how a notebook is found again: a page that has been reloaded, or a second tab opened on the
same file, has no session id to go by and would otherwise start a second kernel on the same notebook
and leave the first running with nothing on it. The kernel is part of the question because switching
a notebook's kernel is asking for a different one, not for the one already there.
*/
func SessionForPath(path, kernelName string) (models.SessionModel, bool) {
	sessions.mu.RLock()
	defer sessions.mu.RUnlock()

	for _, session := range sessions.by {
		if session.Path == path && (kernelName == "" || session.Kernel.Name == kernelName) {
			return session, true
		}
	}
	return models.SessionModel{}, false
}

func SetSession(sessionId string, session models.SessionModel) {
	sessions.mu.Lock()
	defer sessions.mu.Unlock()

	sessions.by[sessionId] = session
}

// RemoveSession takes a session out and says whether it was the one that took it out, so that two
// requests deleting the same session do not both go on to stop its kernel.
func RemoveSession(sessionId string) (models.SessionModel, bool) {
	sessions.mu.Lock()
	defer sessions.mu.Unlock()

	session, ok := sessions.by[sessionId]
	if ok {
		delete(sessions.by, sessionId)
	}
	return session, ok
}

/*
UpdateSessions rewrites the sessions that `update` answers with a replacement for, and returns how
many it changed.

A read-modify-write over the whole store, which is why it is here rather than left to the caller: a
pass that read the sessions, worked out new paths for them and then wrote them back would be writing
over anything that had started or stopped in between.
*/
func UpdateSessions(update func(models.SessionModel) (models.SessionModel, bool)) int {
	sessions.mu.Lock()
	defer sessions.mu.Unlock()

	changed := 0
	for id, session := range sessions.by {
		updated, ok := update(session)
		if !ok {
			continue
		}
		sessions.by[id] = updated
		changed++
	}
	return changed
}

// DeleteSessionsForKernel drops every session bound to the given kernel and
// returns the ids that were removed. Used when a kernel is killed directly,
// without going through its session.
func DeleteSessionsForKernel(kernelId string) []string {
	sessions.mu.Lock()
	defer sessions.mu.Unlock()

	deleted := []string{}
	for sessionId, session := range sessions.by {
		if session.Kernel.Id == kernelId {
			delete(sessions.by, sessionId)
			deleted = append(deleted, sessionId)
		}
	}

	return deleted
}
