//go:build !apiserver
// +build !apiserver

package main

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed ui/build/*
var staticFiles embed.FS

func getSpaHandler() http.Handler {
	files, err := fs.Sub(staticFiles, "ui/build")
	if err != nil {
		// Only a mistyped directory above can cause this, and every build would fail on its first page.
		panic(err)
	}
	return spaHandler{files: files}
}
