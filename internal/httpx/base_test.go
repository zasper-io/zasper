package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestABasePathHasASlashAtEachEnd(t *testing.T) {
	for given, want := range map[string]string{
		"":                "/",
		"/":               "/",
		"/user/prasun":    "/user/prasun/",
		"/user/prasun/":   "/user/prasun/",
		" /team/writers ": "/team/writers/",
		"/a.b/c-d/e_f~g/": "/a.b/c-d/e_f~g/",
	} {
		got, err := BasePath(given)
		require.NoError(t, err, given)
		assert.Equal(t, want, got, given)
	}
}

func TestTheFirstBasePathGivenWins(t *testing.T) {
	got, err := BasePath("", "/user/prasun/", "/user/bob/")
	require.NoError(t, err)
	assert.Equal(t, "/user/prasun/", got)
}

func TestABasePathThatWouldNeedEscapingIsRefused(t *testing.T) {
	for _, given := range []string{
		"user/prasun", "/user//prasun/", "/user/../prasun/", "/user/./prasun", "/user/prasun?x=1", "/user/prasun#top",
		"/user/pra%20sun", "/user/pra sun", `/user/"prasun"`, "/user/prasun<script>", "//evil.example.com/",
	} {
		_, err := BasePath(given)
		assert.Error(t, err, given)
	}
}

func TestAServerUnderABasePathSeesItsOwnRoot(t *testing.T) {
	var seen string
	handler := UnderBase("/user/prasun/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.URL.Path
		w.WriteHeader(http.StatusNoContent)
	}))
	for path, want := range map[string]string{
		"/user/prasun/":             "/",
		"/user/prasun/api/contents": "/api/contents",
		"/user/prasun/login":        "/login",
	} {
		seen = ""
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		assert.Equal(t, http.StatusNoContent, recorder.Code, path)
		assert.Equal(t, want, seen, path)
	}
}

func TestABasePathWithoutItsLastSlashIsRedirected(t *testing.T) {
	handler := UnderBase("/user/prasun/", http.NotFoundHandler())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/user/prasun?token=x", nil))
	assert.Equal(t, http.StatusMovedPermanently, recorder.Code)
	assert.Equal(t, "/user/prasun/?token=x", recorder.Header().Get("Location"))
}

func TestNothingOutsideTheBasePathIsServed(t *testing.T) {
	reached := false
	handler := UnderBase("/user/prasun/", http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	// /user/prasunanand/ starts with /user/prasun, which is why the prefix is matched with its slash.
	for _, path := range []string{"/", "/api/contents", "/user/prasunanand/", "/user/bob/api/contents", "/user/"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		assert.Equal(t, http.StatusNotFound, recorder.Code, path)
	}
	assert.False(t, reached)
}

func TestAtTheRootNothingChanges(t *testing.T) {
	var seen string
	handler := UnderBase("/", http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { seen = r.URL.Path }))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/contents", nil))
	assert.Equal(t, "/api/contents", seen)
}
