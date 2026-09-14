package session

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// A kernel nobody installed is the client's mistake, not the server's: 404 rather than 500.
func TestASessionOnAKernelNobodyInstalledIsNotFound(t *testing.T) {
	s := testSessions(t)

	body := `{"path": "notes.ipynb", "type": "notebook", "kernel": {"name": "no-such-kernel"}}`
	request := httptest.NewRequest(http.MethodPost, "/api/sessions", strings.NewReader(body))
	recorder := httptest.NewRecorder()

	s.CreateHandler(recorder, request)

	assert.Equal(t, http.StatusNotFound, recorder.Code)
	assert.Empty(t, s.List())
}
