//go:build apiserver
// +build apiserver

package main

import (
	"net/http"
	"os"
)

// getSpaHandler serves ui/build from disk, for a build that does not embed the frontend. index.html is
// read as the server starts, so a frontend rebuilt since needs a restart; `make dev` serves it from Vite.
func getSpaHandler(base string) http.Handler {
	return newSpaHandler(os.DirFS("ui/build"), base)
}
