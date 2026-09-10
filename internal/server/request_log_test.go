/*
What the access log records, and — the reason this file exists — that recording it does not break a
websocket.

WithRequestLogging wraps every response in a responseRecorder. A wrapper that does not forward
http.Hijacker turns every websocket route in the server into a failed upgrade, and nothing else in
the suite would notice, because the middleware is installed in app.go rather than in NewRouter.
*/
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
captureLogs hands `during` a logger writing to a buffer and answers the lines it collected, parsed.

Nothing global is touched. The rest of this package's tests start kernels whose goroutines keep
logging after the test that started them returns, so swapping zerolog's global logger here would be a
data race rather than a test fixture.
*/
func captureLogs(t *testing.T, level zerolog.Level, during func(logger zerolog.Logger)) []map[string]any {
	t.Helper()

	buffer := &lockedBuffer{}
	during(zerolog.New(buffer).Level(level))

	lines := []map[string]any{}
	for _, line := range strings.Split(strings.TrimSpace(buffer.String()), "\n") {
		if line == "" {
			continue
		}
		entry := map[string]any{}
		require.NoError(t, json.Unmarshal([]byte(line), &entry), "log line is not JSON: %s", line)
		lines = append(lines, entry)
	}
	return lines
}

func TestRequestLoggingRecordsTheAnswer(t *testing.T) {
	lines := captureLogs(t, zerolog.InfoLevel, func(logger zerolog.Logger) {
		handler := WithRequestLogging(logger, false, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTeapot)
			w.Write([]byte("short and stout"))
		}))
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPut, "/api/contents", nil))
	})

	require.Len(t, lines, 1)
	assert.Equal(t, "PUT", lines[0]["method"])
	assert.Equal(t, "/api/contents", lines[0]["path"])
	assert.Equal(t, float64(http.StatusTeapot), lines[0]["status"])
	assert.Equal(t, float64(len("short and stout")), lines[0]["bytes"])
	// 4xx is the server answering "no", which is worth seeing without --debug but is not an error.
	assert.Equal(t, "warn", lines[0]["level"])
}

func TestRequestLoggingLevelFollowsTheStatus(t *testing.T) {
	for name, testCase := range map[string]struct {
		status int
		level  string
	}{
		"a refused one": {http.StatusUnauthorized, "warn"},
		"a broken one":  {http.StatusInternalServerError, "error"},
	} {
		t.Run(name, func(t *testing.T) {
			lines := captureLogs(t, zerolog.InfoLevel, func(logger zerolog.Logger) {
				handler := WithRequestLogging(logger, false, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(testCase.status)
				}))
				handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/info", nil))
			})

			require.Len(t, lines, 1)
			assert.Equal(t, testCase.level, lines[0]["level"])
		})
	}
}

// The readiness probe is polled by process managers and by the e2e harness, so at info it would be
// most of the log.
func TestHealthChecksAreOnlyLoggedInDebug(t *testing.T) {
	call := func(verbose bool) func(zerolog.Logger) {
		return func(logger zerolog.Logger) {
			handler := WithRequestLogging(logger, verbose, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
			handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/health", nil))
		}
	}

	assert.Empty(t, captureLogs(t, zerolog.InfoLevel, call(false)))
	// Even with the access log asked for: it is the probe a process manager polls.
	assert.Empty(t, captureLogs(t, zerolog.InfoLevel, call(true)))
	assert.Len(t, captureLogs(t, zerolog.DebugLevel, call(false)), 1)
}

/*
The reason the levels are what they are: expanding one directory in the file browser is a preflight
and a POST, and under `make dev` every directory the tree opens repeats the pair. At info that is
most of the log and none of it is worth reading.
*/
func TestServedRequestsAreQuietUntilAskedFor(t *testing.T) {
	expandADirectory := func(verbose bool) func(zerolog.Logger) {
		return func(logger zerolog.Logger) {
			handler := WithRequestLogging(logger, verbose, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusNoContent)
					return
				}
				w.Write([]byte("{}"))
			}))
			for _, method := range []string{http.MethodOptions, http.MethodPost} {
				handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(method, "/api/contents", nil))
			}
		}
	}

	assert.Empty(t, captureLogs(t, zerolog.InfoLevel, expandADirectory(false)),
		"a request that worked should not be visible without ZASPER_ACCESS_LOG")
	assert.Len(t, captureLogs(t, zerolog.DebugLevel, expandADirectory(false)), 2,
		"and should still be there under --debug")

	verbose := captureLogs(t, zerolog.InfoLevel, expandADirectory(true))
	require.Len(t, verbose, 2)
	for _, line := range verbose {
		assert.Equal(t, "info", line["level"])
	}
}

// A token can only reach a websocket route in the query string, so the access log is the one place
// it must not be written down.
func TestRequestLoggingOmitsTheQueryString(t *testing.T) {
	lines := captureLogs(t, zerolog.InfoLevel, func(logger zerolog.Logger) {
		handler := WithRequestLogging(logger, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		request := httptest.NewRequest(http.MethodGet, "/api/contents/watch?token=super-secret", nil)
		handler.ServeHTTP(httptest.NewRecorder(), request)
	})

	require.Len(t, lines, 1)
	assert.Equal(t, "/api/contents/watch", lines[0]["path"])

	// Re-marshalled rather than field by field, so that a field added later is covered too.
	entry, err := json.Marshal(lines[0])
	require.NoError(t, err)
	assert.NotContains(t, string(entry), "super-secret", "the token leaked into the access log")
}

func TestRequestLoggingLetsAWebsocketUpgrade(t *testing.T) {
	upgrader := websocket.Upgrader{}

	// Closed outside the middleware rather than inside the handler, so that it signals after the log
	// line is written rather than just before it — otherwise the test reads the buffer as it is filled.
	served := make(chan struct{})

	lines := captureLogs(t, zerolog.InfoLevel, func(logger zerolog.Logger) {
		logged := WithRequestLogging(logger, true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer conn.Close()
			conn.WriteMessage(websocket.TextMessage, []byte("upgraded"))
		}))

		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer close(served)
			logged.ServeHTTP(w, r)
		}))
		defer srv.Close()

		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/kernels", nil)
		require.NoError(t, err, "the upgrade failed, which means the recorder is not forwarding Hijack")

		_, message, err := conn.ReadMessage()
		require.NoError(t, err)
		assert.Equal(t, "upgraded", string(message))

		conn.Close()
		<-served
	})

	// The handler hijacked the connection and wrote its own 101, so the recorder has to say 101
	// rather than the 200 it assumes for a handler that never calls WriteHeader.
	require.Len(t, lines, 1)
	assert.Equal(t, float64(http.StatusSwitchingProtocols), lines[0]["status"])
}

// lockedBuffer is the log sink for these tests: the websocket case is written from the server's
// goroutine and read from the test's, so an unguarded strings.Builder is a race.
type lockedBuffer struct {
	mu      sync.Mutex
	builder strings.Builder
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.builder.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.builder.String()
}
