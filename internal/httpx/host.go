package httpx

import (
	"fmt"
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

allowed names the other hosts to answer to. A reverse proxy on the same machine forwards the name the
browser used, and has to, because the websocket and write checks compare Origin with Host; so the only
way to serve behind one is to name it here.
*/
func LoopbackHostOnly(next http.Handler, allowed []string) http.Handler {
	names := make(map[string]bool, len(allowed))
	for _, name := range allowed {
		names[hostName(name)] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isLoopbackHost(r.Host) && !names[hostName(r.Host)] {
			SendErrorResponse(w, http.StatusForbidden, "This server only answers to localhost; start it with --allow-host to reach it by another name")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// hostName is a Host header's name alone, compared the way DNS compares names: without the port, the
// brackets around an IPv6 address, the case, or a trailing dot.
func hostName(hostport string) string {
	host := hostport
	if split, _, err := net.SplitHostPort(hostport); err == nil {
		host = split
	}
	return strings.TrimSuffix(strings.Trim(strings.ToLower(host), "[]"), ".")
}

func isLoopbackHost(hostport string) bool {
	host := hostName(hostport)

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

/*
AllowedHosts reads the host names given on the command line and in ZASPER_ALLOWED_HOSTS, each a
comma-separated list. A port is dropped, since the check never compares one. Anything that is not a
bare name is refused rather than kept: "https://zasper.example.com" would never match a Host header,
and a server that starts but answers 403 to its proxy is harder to diagnose than one that says why.
*/
func AllowedHosts(lists ...string) ([]string, error) {
	var hosts []string
	for _, list := range lists {
		for _, entry := range strings.Split(list, ",") {
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}
			// Checked before the port is split off, which would read "https://x" as the host "https".
			name := hostName(entry)
			if strings.ContainsAny(entry, "/@?#* ") || name == "" || strings.Contains(name, ":") && net.ParseIP(name) == nil {
				return nil, fmt.Errorf("%q is not a host name; give the name alone, such as zasper.example.com", entry)
			}
			hosts = append(hosts, name)
		}
	}
	return hosts, nil
}
