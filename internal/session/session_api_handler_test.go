package session

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zasper-io/zasper/internal/core"
)

// A kernel nobody installed is the client's mistake, not the server's: 404 rather than 500.
func TestASessionOnAKernelNobodyInstalledIsNotFound(t *testing.T) {
	sessionsFor(t)
	previous := core.Zasper.JupyterPath
	core.Zasper.JupyterPath = []string{t.TempDir()}
	t.Cleanup(func() { core.Zasper.JupyterPath = previous })

	body := `{"path": "notes.ipynb", "type": "notebook", "kernel": {"name": "no-such-kernel"}}`
	request := httptest.NewRequest(http.MethodPost, "/api/sessions", strings.NewReader(body))
	recorder := httptest.NewRecorder()

	SessionCreateApiHandler(recorder, request)

	assert.Equal(t, http.StatusNotFound, recorder.Code)
	assert.Empty(t, core.ListSessions())
}
