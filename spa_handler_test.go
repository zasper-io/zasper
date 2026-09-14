package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
)

func frontendGet(path string) *httptest.ResponseRecorder {
	files := fstest.MapFS{
		"index.html":             {Data: []byte("<html>the app</html>")},
		"assets/index-3f9a1c.js": {Data: []byte("console.log(1)")},
		"favicon-16.png":         {Data: []byte("png")},
	}

	recorder := httptest.NewRecorder()
	spaHandler{files: files}.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	return recorder
}

func TestAFileIsServedAsItself(t *testing.T) {
	recorder := frontendGet("/favicon-16.png")

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "png", recorder.Body.String())
	assert.Empty(t, recorder.Header().Get("Cache-Control"))
}

func TestAHashedAssetIsKeptForAYear(t *testing.T) {
	recorder := frontendGet("/assets/index-3f9a1c.js")

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "console.log(1)", recorder.Body.String())
	assert.Equal(t, "public, max-age=31536000, immutable", recorder.Header().Get("Cache-Control"))
}

func TestEveryOtherAddressIsTheAppRevalidatedEachTime(t *testing.T) {
	for _, path := range []string{"/", "/some/deep/link", "/assets", "/assets/gone-1234.js"} {
		t.Run(path, func(t *testing.T) {
			recorder := frontendGet(path)

			assert.Equal(t, http.StatusOK, recorder.Code)
			assert.Equal(t, "<html>the app</html>", recorder.Body.String())
			assert.Equal(t, "no-cache", recorder.Header().Get("Cache-Control"))
			assert.Contains(t, recorder.Header().Get("Content-Type"), "text/html")
		})
	}
}
