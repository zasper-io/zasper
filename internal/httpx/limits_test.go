package httpx

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestABodyOverTheLimitCannotBeRead(t *testing.T) {
	handler := LimitBody(8, "/api/contents/upload")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.ReadAll(r.Body); err != nil {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, c := range []struct {
		path, body string
		want       int
	}{
		{"/api/contents", "12345678", http.StatusNoContent},
		{"/api/contents", "123456789", http.StatusRequestEntityTooLarge},
		{"/api/contents/upload", "123456789", http.StatusNoContent},
	} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, c.path, strings.NewReader(c.body)))
		assert.Equal(t, c.want, recorder.Code, "%d bytes to %s", len(c.body), c.path)
	}
}
