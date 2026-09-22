package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestALoopbackServerAnswersOnlyToLoopbackNames(t *testing.T) {
	handler := LoopbackHostOnly(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), nil)

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

// A reverse proxy on the same machine forwards the browser's host name, so a server behind one answers
// to that name as well, and still to nothing else.
func TestALoopbackServerAlsoAnswersToTheHostsItIsGiven(t *testing.T) {
	handler := LoopbackHostOnly(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), []string{"zasper.example.com"})

	for host, allowed := range map[string]bool{
		"zasper.example.com":      true,
		"zasper.example.com:443":  true,
		"Zasper.Example.COM.":     true,
		"localhost:8048":          true,
		"evil.example.com":        false,
		"zasper.example.com.evil": false,
		"example.com":             false,
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

func TestAllowedHostsAreNamesAlone(t *testing.T) {
	hosts, err := AllowedHosts("zasper.example.com, Notebooks.Example.com:443", "", "10.0.0.5,[::1]")
	require.NoError(t, err)
	assert.Equal(t, []string{"zasper.example.com", "notebooks.example.com", "10.0.0.5", "::1"}, hosts)

	for _, bad := range []string{"https://zasper.example.com", "zasper.example.com/lab", "*.example.com", "user@host"} {
		_, err := AllowedHosts(bad)
		assert.Error(t, err, bad)
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
