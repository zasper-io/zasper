//go:build apiserver

package httpx

// devOrigins are the vite dev server's. `make dev` serves the frontend from there while this process,
// built with the apiserver tag, serves the API; no other build trusts them.
var devOrigins = []string{
	"http://localhost:3000",
	"http://127.0.0.1:3000",
}
