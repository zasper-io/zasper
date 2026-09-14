package main

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

/*
spaHandler serves the built frontend: a file that exists is served as itself, and any other path gets
index.html, because the frontend's router owns every address that is not a file.

Files under assets/ have a content hash in their names, so a browser may keep them for a year without
asking again. index.html names those files, so it is revalidated on every load.
*/
type spaHandler struct {
	files fs.FS
}

const indexFile = "index.html"

func (h spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// path rather than filepath: an fs.FS is slash-separated on every platform. Cleaned from the root,
	// so no number of `..` climbs out of it.
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")

	info, err := fs.Stat(h.files, name)
	switch {
	case name == "" || errors.Is(err, fs.ErrNotExist) || (err == nil && info.IsDir()):
		h.serveIndex(w, r)
	case err != nil:
		http.Error(w, err.Error(), http.StatusInternalServerError)
	default:
		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.ServeFileFS(w, r, h.files, name)
	}
}

func (h spaHandler) serveIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, h.files, indexFile)
}
