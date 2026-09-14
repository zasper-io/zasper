package http

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestALoopbackServerAnswersOnlyToLoopbackNames(t *testing.T) {
	handler := LoopbackHostOnly(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for host, allowed := range map[string]bool{
		"localhost:8048":     true,
		"LOCALHOST:8048":     true,
		"localhost":          true,
		"app.localhost:8048": true,
		"127.0.0.1:8048":     true,
		"127.0.0.2:8048":     true,
		"[::1]:8048":         true,
		// A rebound domain resolves to 127.0.0.1 but still names itself.
		"evil.example.com:8048":   false,
		"localhost.evil.com:8048": false,
		"192.168.1.10:8048":       false,
		"":                        false,
	} {
		t.Run(host, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/config", nil)
			r.Host = host
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, r)

			assert.Equal(t, allowed, recorder.Code == http.StatusNoContent, "answered %d", recorder.Code)
		})
	}
}

func TestALoopbackBindIsToldApartFromAWiderOne(t *testing.T) {
	for address, loopback := range map[string]bool{
		"127.0.0.1:8048":    true,
		"[::1]:8048":        true,
		"localhost:8048":    true,
		"0.0.0.0:8048":      false,
		"[::]:8048":         false,
		":8048":             false,
		"192.168.1.10:8048": false,
	} {
		assert.Equal(t, loopback, IsLoopbackBind(address), address)
	}
}
