package httpx

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
)

// ResponseRecorder passes a response through and remembers its status and size. Hijack and Flush are
// forwarded by hand: a websocket upgrade hijacks the connection, and a wrapper that does not pass that
// through breaks every websocket route behind it.
type ResponseRecorder struct {
	http.ResponseWriter
	Status  int
	Written int
}

func NewResponseRecorder(w http.ResponseWriter) *ResponseRecorder {
	return &ResponseRecorder{ResponseWriter: w, Status: http.StatusOK}
}

func (rec *ResponseRecorder) WriteHeader(status int) {
	rec.Status = status
	rec.ResponseWriter.WriteHeader(status)
}

func (rec *ResponseRecorder) Write(b []byte) (int, error) {
	n, err := rec.ResponseWriter.Write(b)
	rec.Written += n
	return n, err
}

func (rec *ResponseRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := rec.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("the underlying ResponseWriter does not support hijacking")
	}
	// The upgrade writes its own 101 straight to the connection.
	rec.Status = http.StatusSwitchingProtocols
	return hijacker.Hijack()
}

func (rec *ResponseRecorder) Flush() {
	if flusher, ok := rec.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}
