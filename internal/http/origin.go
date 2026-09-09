package http

import (
	"net/http"
	"net/url"
	"strings"
)

// The vite dev server. `make dev` serves the frontend from there while this process serves the API,
// which is the only cross-origin caller the app has ever had — in a release build the SPA is served
// by this process and is same-origin.
var devOrigins = []string{
	"http://localhost:3000",
	"http://127.0.0.1:3000",
}

/*
SameOrigin reports whether a request may open a websocket against this server.

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
