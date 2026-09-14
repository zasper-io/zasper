package auth

import (
	"sync"
	"time"
)

/*
revokedSessions holds the sessions signed out before they expired, until they would have expired anyway.

In memory only. A restart with a fresh access token invalidates every session regardless; one with
ZASPER_ACCESS_TOKEN pinned forgets these, so a session signed out before such a restart is valid again
until it expires. The README says so.
*/
type revokedSessions struct {
	mu       sync.Mutex
	sessions map[string]time.Time
}

func newRevokedSessions() *revokedSessions {
	return &revokedSessions{sessions: map[string]time.Time{}}
}

func (r *revokedSessions) add(id string, expires time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	for other, until := range r.sessions {
		if now.After(until) {
			delete(r.sessions, other)
		}
	}
	r.sessions[id] = expires
}

func (r *revokedSessions) has(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	_, found := r.sessions[id]
	return found
}

const (
	// maxFailedLogins wrong tokens within loginWindow hold a client off until the window ends. The
	// token is 128 random bits, so this is not what makes guessing it impractical; it keeps a script
	// hammering the port from filling the log.
	maxFailedLogins = 10
	loginWindow     = time.Minute
)

type failedLogins struct {
	count int
	since time.Time
}

// loginLimiter counts failed sign-ins per client address.
type loginLimiter struct {
	mu      sync.Mutex
	clients map[string]*failedLogins
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{clients: map[string]*failedLogins{}}
}

// blocked answers how long client has to wait before it may try again, or zero.
func (l *loginLimiter) blocked(client string, now time.Time) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()

	failures := l.clients[client]
	if failures == nil {
		return 0
	}
	elapsed := now.Sub(failures.since)
	if elapsed >= loginWindow {
		delete(l.clients, client)
		return 0
	}
	if failures.count >= maxFailedLogins {
		return loginWindow - elapsed
	}
	return 0
}

func (l *loginLimiter) failed(client string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Every window that has ended is dropped here, so addresses that tried once and left do not
	// accumulate.
	for address, failures := range l.clients {
		if now.Sub(failures.since) >= loginWindow {
			delete(l.clients, address)
		}
	}

	failures := l.clients[client]
	if failures == nil {
		failures = &failedLogins{since: now}
		l.clients[client] = failures
	}
	failures.count++
}

func (l *loginLimiter) succeeded(client string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	delete(l.clients, client)
}
