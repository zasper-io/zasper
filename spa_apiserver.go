//go:build apiserver
// +build apiserver

package main

import (
	"net/http"
	"os"
)

// getSpaHandler serves ui/build from disk, for a build that does not embed the frontend.
func getSpaHandler() http.Handler {
	return spaHandler{files: os.DirFS("ui/build")}
}
