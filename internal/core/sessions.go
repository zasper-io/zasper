package core

import "github.com/zasper-io/zasper/internal/models"

var ZasperSession map[string]models.SessionModel

func SetUpActiveSessions() map[string]models.SessionModel {
	return make(map[string]models.SessionModel)
}

// DeleteSessionsForKernel drops every session bound to the given kernel and
// returns the ids that were removed. Used when a kernel is killed directly,
// without going through its session.
func DeleteSessionsForKernel(kernelId string) []string {
	deleted := []string{}

	for sessionId, session := range ZasperSession {
		if session.Kernel.Id == kernelId {
			delete(ZasperSession, sessionId)
			deleted = append(deleted, sessionId)
		}
	}

	return deleted
}
