package http

import (
	"net/http"
	"net/url"
	"slices"
	"strings"
)

// DevOrigins answers the origins of `make dev`'s frontend, which a development build trusts as its
// own and a release build does not trust at all; see dev_origins.go.
func DevOrigins() []string {
	return slices.Clone(devOrigins)
}

/*
SameOrigin reports whether a request came from Zasper's own page, for opening a websocket or changing
something with the session cookie.

gorilla/websocket calls this on every upgrade, and both handlers used to answer true unconditionally.
A websocket is not same-origin by default the way fetch is, so that let any page open in the browser
reach a terminal or a kernel on this machine, whatever the page.

No Origin header means the caller is not a browser — curl, or a native client — so it is allowed and
left to whatever authentication the route itself carries.
*/
func SameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}

	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if strings.EqualFold(parsed.Host, r.Host) {
		return true
	}

	for _, allowed := range devOrigins {
		if strings.EqualFold(origin, allowed) {
			return true
		}
	}
	return false
}
