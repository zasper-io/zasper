//go:build !apiserver

package httpx

// devOrigins is empty in a build that embeds the frontend: it serves its own page, so any other
// server on port 3000 is as foreign to it as any other site.
var devOrigins []string
