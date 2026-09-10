/*
What the server binds, and what it tells you it bound.

Getting this wrong is not a cosmetic bug: a bind that reaches the network hands /api/contents and a
terminal to whoever can open the port, and a banner that says "localhost" while bound to 0.0.0.0
hides exactly that. These are the rules that keep the default on loopback and the banner honest.
*/
package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestListenAddress(t *testing.T) {
	for name, testCase := range map[string]struct {
		host, port string
		want       string
	}{
		"the default is loopback, not every interface": {"127.0.0.1", ":8048", "127.0.0.1:8048"},
		"a bare port is joined to the host":            {"127.0.0.1", "8048", "127.0.0.1:8048"},
		"--host widens the bind":                       {"0.0.0.0", ":8048", "0.0.0.0:8048"},
		// Someone's existing script passes the whole thing through --port; it keeps working, and it
		// keeps binding what it always bound.
		"a --port carrying a host wins over --host": {"127.0.0.1", "0.0.0.0:9000", "0.0.0.0:9000"},
		"an IPv6 host is bracketed":                 {"::1", ":8048", "[::1]:8048"},
	} {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, testCase.want, listenAddress(testCase.host, testCase.port))
		})
	}
}

func TestIsLoopback(t *testing.T) {
	for address, want := range map[string]bool{
		"127.0.0.1:8048": true,
		"localhost:8048": true,
		"[::1]:8048":     true,
		"127.0.0.2:8048": true,
		"0.0.0.0:8048":   false,
		"[::]:8048":      false,
		"192.168.1.5:80": false,
		// Not an IP and not localhost: resolving it here would report on DNS rather than on what was
		// bound, so it counts as reachable and earns the warning.
		"example.com:8048": false,
		"nonsense":         false,
	} {
		t.Run(address, func(t *testing.T) {
			assert.Equal(t, want, isLoopback(address))
		})
	}
}

func TestBrowsableURL(t *testing.T) {
	for address, want := range map[string]string{
		"127.0.0.1:8048": "http://127.0.0.1:8048",
		// A wildcard bind is not somewhere a browser can navigate, so the printed URL has to differ
		// from the bind rather than repeat it.
		"0.0.0.0:8048": "http://localhost:8048",
		"[::]:8048":    "http://localhost:8048",
		"[::1]:8048":   "http://[::1]:8048",
	} {
		t.Run(address, func(t *testing.T) {
			assert.Equal(t, want, browsableURL(address))
		})
	}
}
