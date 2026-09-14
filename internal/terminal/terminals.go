package terminal

import (
	"fmt"
	"sync/atomic"
	"time"

	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/store"
)

// Terminals are the shells a server runs for one project, by session id.
type Terminals struct {
	project  content.Project
	sessions store.Map[string, *Session]
	// Counts the sessions handed out, which is what makes their ids unique.
	sessionSeq atomic.Uint64
}

// New starts with no shells running.
func New(project content.Project) *Terminals {
	return &Terminals{project: project}
}

/*
newSessionID names one connection's shell: the terminal id the client tab gave, a counter, and the time.

The counter is what makes an id unique. The wall clock is far coarser than a nanosecond on some systems, so
two terminals opened in the same tick used to get the same id and the second evicted the first, leaving a
shell nothing could list or kill. The timestamp is kept for the log lines.
*/
func (ts *Terminals) newSessionID(terminalId string) string {
	return fmt.Sprintf("%s-%d-%d", terminalId, ts.sessionSeq.Add(1), time.Now().UnixNano())
}

func (ts *Terminals) register(sessionID string, session *Session) {
	ts.sessions.Set(sessionID, session)
}

func (ts *Terminals) unregister(sessionID string) {
	ts.sessions.Take(sessionID)
}
