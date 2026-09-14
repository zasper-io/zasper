package health

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTheHealthCheckSaysTheServerIsAlive(t *testing.T) {
	recorder := httptest.NewRecorder()

	HealthCheckHandler(recorder, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "application/json", recorder.Header().Get("Content-Type"))
	assert.JSONEq(t, `{"alive": true}`, recorder.Body.String())
}
