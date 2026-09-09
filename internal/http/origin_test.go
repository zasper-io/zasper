/*
Which pages may open a websocket against this server.

A websocket is not same-origin by default the way fetch is, so `SameOrigin` is the whole of that
defence: before it, both upgraders answered `true` unconditionally and any page in the browser could
open a terminal or attach to a kernel on this machine. internal/server/auth_test.go proves the two
routes are wired to it; these are the cases the routes cannot express.
*/
package http

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

// request builds an upgrade request for `host`, carrying `origin` when there is one — an empty
// string means the header is absent rather than blank, which is a case of its own.
func request(host, origin string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "http://"+host+"/ws/terminals/x", nil)
	r.Host = host
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	return r
}

func TestSameOriginAnswersForEachKindOfCaller(t *testing.T) {
	cases := map[string]struct {
		host    string
		origin  string
		allowed bool
	}{
		// A browser always sends Origin on a websocket handshake, so a request without one is
		// something else — curl, or a native client — and is left to the route's own authentication.
		"no origin at all":            {"localhost:8048", "", true},
		"the page this server serves": {"localhost:8048", "http://localhost:8048", true},
		"another site entirely":       {"localhost:8048", "https://evil.example.com", false},

		// The port is part of the origin, so a different server on the same machine is a different
		// site. This is what stops one local app reaching into another.
		"same host, another port": {"localhost:8048", "http://localhost:9999", false},
		"host with no port":       {"localhost:8048", "http://localhost", false},

		// Hosts are case-insensitive; the scheme is deliberately not compared, so a page served over
		// https on the same host and port is allowed to connect.
		"host in another case": {"LocalHost:8048", "http://localhost:8048", true},
		"https to the same":    {"localhost:8048", "https://localhost:8048", true},

		// url.Parse takes almost anything, so the guard that matters is the host comparison rather
		// than the parse error: garbage parses cleanly to an empty host and is refused there.
		"not a url":     {"localhost:8048", "not a url", false},
		"empty-ish url": {"localhost:8048", "///", false},

		"an ip, matching":     {"127.0.0.1:8048", "http://127.0.0.1:8048", true},
		"an ip, not matching": {"127.0.0.1:8048", "http://10.0.0.1:8048", false},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, c.allowed, SameOrigin(request(c.host, c.origin)))
		})
	}
}

/*
The dev server is allowed from anywhere, in every build.

`make dev` serves the frontend on 3000 while this process serves the API, and there is no build tag
separating that from a release. So a page on localhost:3000 can open a terminal socket on a machine
running a released Zasper — a real if narrow hole, and one worth failing a test if anybody widens it.
*/
func TestTheViteDevServerIsAllowedAgainstAnyHost(t *testing.T) {
	for _, origin := range devOrigins {
		t.Run(origin, func(t *testing.T) {
			assert.True(t, SameOrigin(request("localhost:8048", origin)))
			assert.True(t, SameOrigin(request("192.168.1.10:8048", origin)))
		})
	}

	// The allowance is the exact origin and not the host, so the same port over https, or a
	// neighbouring port, is still a foreign site.
	assert.False(t, SameOrigin(request("localhost:8048", "https://localhost:3000")))
	assert.False(t, SameOrigin(request("localhost:8048", "http://localhost:3001")))
}
