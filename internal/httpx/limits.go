package httpx

import (
	"net/http"
	"slices"
)

// LimitBody refuses to read more than limit bytes of a request body, except on the paths named as
// unlimited. A handler reading past the limit gets an error from the body, as a decode that fails.
func LimitBody(limit int64, unlimited ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !slices.Contains(unlimited, r.URL.Path) {
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}
