package main

import (
	"bytes"
	"errors"
	"html"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

/*
spaHandler serves the built frontend: a file that exists is served as itself, and any other path gets
index.html, because the frontend's router owns every address that is not a file.

Files under assets/ have a content hash in their names, so a browser may keep them for a year without
asking again. index.html names those files, so it is revalidated on every load.
*/
type spaHandler struct {
	files fs.FS
	// index.html with its <base> naming the server's base path, made once; nil serves the file as it is.
	index []byte
}

const indexFile = "index.html"

// baseElement is the <base> ui/index.html is built with, which names the root.
var baseElement = []byte(`<base href="/" />`)

/*
newSpaHandler serves files at base. The page's own links (its scripts, styles, icons and manifest) are
relative, and its <base> says what to: a server at /user/prasun/ serves a page whose every link is under
/user/prasun/, from any address the router owns, however deep. The frontend reads its API's address from
the same element.
*/
func newSpaHandler(files fs.FS, base string) spaHandler {
	page, err := fs.ReadFile(files, indexFile)
	if err != nil {
		return spaHandler{files: files}
	}
	element := []byte(`<base href="` + html.EscapeString(base) + `" />`)
	return spaHandler{files: files, index: bytes.Replace(page, baseElement, element, 1)}
}

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
	if h.index == nil {
		http.ServeFileFS(w, r, h.files, indexFile)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(w, r, indexFile, time.Time{}, bytes.NewReader(h.index))
}
