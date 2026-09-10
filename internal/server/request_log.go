package server

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/rs/zerolog"
)

/*
WithRequestLogging writes a line per request: what was asked, what came back, and how long it took.

It wraps the whole handler rather than sitting on the router as mux middleware, so that a request
matching no route is logged too — a 404 on a path the frontend expected to exist is exactly the kind
of thing this is here for.

Only the path is logged, never the query string: a websocket route authenticates by `?token=`,
and the point of an access log is not to be the place that token ends up.

The logger is a parameter rather than zerolog's global because a test that wanted to read these lines
would otherwise have to swap the global out, which races every background goroutine the rest of the
suite leaves logging.

`verbose` raises a request that worked from debug to info — see event() for why that is not the
default.
*/
func WithRequestLogging(logger zerolog.Logger, verbose bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &responseRecorder{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(recorder, r)

		event(logger, verbose, recorder.status, r.URL.Path).
			Str("method", r.Method).
			Str("path", r.URL.Path).
			Int("status", recorder.status).
			Int("bytes", recorder.written).
			// Microseconds rather than Dur, which renders the full float and buries the number that
			// matters under six digits of noise.
			Float64("took_ms", float64(time.Since(started).Microseconds())/1000).
			Send()
	})
}

/*
event picks the level from the answer: a failure is worth a line by default, a request that worked
is not.

Logging every 2xx at info drowns the log. The file browser POSTs once per directory it expands, and
under `make dev` the browser sends a CORS preflight before each of those, so one click in the tree is
eight lines that nobody would act on. What someone reads a local server's log for is the request that
went wrong, and those stay visible with no flag at all.

ZASPER_ACCESS_LOG=1 turns the full access log back on without --debug, which is otherwise the only
way to get it and which also turns on per-ZMQ-message kernel logging.
*/
func event(logger zerolog.Logger, verbose bool, status int, path string) *zerolog.Event {
	switch {
	case status >= http.StatusInternalServerError:
		return logger.Error()
	case status >= http.StatusBadRequest:
		return logger.Warn()
	// The readiness probe that process managers and the e2e harness poll: noise even when the rest of
	// the access log has been asked for.
	case path == "/api/health":
		return logger.Debug()
	case verbose:
		return logger.Info()
	default:
		return logger.Debug()
	}
}

// responseRecorder remembers what the handler answered. It has to forward Hijack and Flush by hand:
// a websocket upgrade hijacks the connection, and wrapping a ResponseWriter without passing those
// through is how a wrapper like this silently breaks every websocket route in the server.
type responseRecorder struct {
	http.ResponseWriter
	status  int
	written int
}

func (rec *responseRecorder) WriteHeader(status int) {
	rec.status = status
	rec.ResponseWriter.WriteHeader(status)
}

func (rec *responseRecorder) Write(b []byte) (int, error) {
	n, err := rec.ResponseWriter.Write(b)
	rec.written += n
	return n, err
}

func (rec *responseRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := rec.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("logging: underlying ResponseWriter does not support hijacking")
	}
	// The upgrade wrote its own 101 straight to the connection, so record it here or the line reads
	// as a 200.
	rec.status = http.StatusSwitchingProtocols
	return hijacker.Hijack()
}

func (rec *responseRecorder) Flush() {
	if flusher, ok := rec.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}
