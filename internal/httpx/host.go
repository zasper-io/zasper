package httpx

import (
	"net"
	"net/http"
	"strings"
)

/*
LoopbackHostOnly refuses a request whose Host header does not name this machine's loopback interface,
for a server bound only to loopback.

A page on any site can point its own domain at 127.0.0.1 (DNS rebinding) and then talk to this server
as though it were same-origin. The Host header still carries that domain, which is how the request is
told apart. With the token required everywhere else, what a rebound page could reach was /api/health,
/api/config and /auth/login; this closes those too.
*/
func LoopbackHostOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isLoopbackHost(r.Host) {
			SendErrorResponse(w, http.StatusForbidden, "This server only answers to localhost; start it with --host to reach it by another name")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isLoopbackHost(hostport string) bool {
	host := hostport
	if split, _, err := net.SplitHostPort(hostport); err == nil {
		host = split
	}
	host = strings.TrimSuffix(strings.Trim(strings.ToLower(host), "[]"), ".")

	// RFC 6761 reserves localhost and every name under it for loopback, and browsers resolve them
	// themselves, so no DNS answer can move them elsewhere.
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// IsLoopbackBind reports whether a listen address such as 127.0.0.1:8048 is reachable from this
// machine only.
func IsLoopbackBind(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil || host == "" {
		return false
	}
	return isLoopbackHost(host)
}
