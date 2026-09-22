/*
What the server binds, and what it tells you it bound.

Getting this wrong is not a cosmetic bug: a bind that reaches the network hands /api/contents and a
terminal to whoever can open the port, and a banner that says "localhost" while bound to 0.0.0.0
hides exactly that. These are the rules that keep the default on loopback and the banner honest.
*/
package main

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestALoopbackServerRefusesARequestNamingAnotherHost(t *testing.T) {
	answered := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })

	for _, c := range []struct {
		bind, host string
		want       int
	}{
		{"127.0.0.1:8048", "localhost:8048", http.StatusNoContent},
		{"127.0.0.1:8048", "rebound.example.com:8048", http.StatusForbidden},
		// Bound to the network, the server is reached by whatever name the network gives it.
		{"0.0.0.0:8048", "my-server:8048", http.StatusNoContent},
	} {
		r := httptest.NewRequest(http.MethodGet, "/api/config", nil)
		r.Host = c.host
		recorder := httptest.NewRecorder()

		appHandler(answered, c.bind).ServeHTTP(recorder, r)

		assert.Equal(t, c.want, recorder.Code, "%s asked of a server bound to %s", c.host, c.bind)
	}
}

// runningServer serves handler on a loopback port and answers the server and its address.
func runningServer(t *testing.T, handler http.HandlerFunc) (*http.Server, string) {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	httpServer := &http.Server{Handler: handler}
	go httpServer.Serve(listener)
	t.Cleanup(func() { httpServer.Close() })

	return httpServer, listener.Addr().String()
}

// On Ctrl-C a save in flight has to finish before the kernels are stopped underneath it.
func TestShuttingDownLetsARunningRequestFinishBeforeCleaningUp(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	httpServer, address := runningServer(t, func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		io.WriteString(w, "saved")
	})

	answered := make(chan string, 1)
	go func() {
		response, err := http.Get("http://" + address)
		if err != nil {
			answered <- err.Error()
			return
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		answered <- string(body)
	}()
	<-started

	var cleanedUp atomic.Bool
	done := make(chan struct{})
	go func() {
		shutDown(httpServer, 5*time.Second, func() { cleanedUp.Store(true) })
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("shutdown finished while a request was still running")
	case <-time.After(200 * time.Millisecond):
	}
	assert.False(t, cleanedUp.Load(), "cleaned up underneath a running request")

	close(release)
	assert.Equal(t, "saved", <-answered)
	<-done
	assert.True(t, cleanedUp.Load())

	_, err := net.Dial("tcp", address)
	assert.Error(t, err, "the server is still accepting connections")
}

func TestShuttingDownStillCleansUpWhenARequestNeverFinishes(t *testing.T) {
	started, never := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() { close(never) })
	httpServer, address := runningServer(t, func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-never
	})
	go http.Get("http://" + address)
	<-started

	var cleanedUp atomic.Bool
	shutDown(httpServer, 100*time.Millisecond, func() { cleanedUp.Store(true) })

	assert.True(t, cleanedUp.Load())
}

func TestListenAddress(t *testing.T) {
	for name, testCase := range map[string]struct {
		host, port string
		want       string
	}{
		"the default is loopback, not every interface": {"127.0.0.1", ":8048", "127.0.0.1:8048"},
		"a bare port is joined to the host":            {"127.0.0.1", "8048", "127.0.0.1:8048"},
		"--host widens the bind":                       {"0.0.0.0", ":8048", "0.0.0.0:8048"},
		// Someone's existing script passes the whole thing through --port; it keeps working, and it
		// keeps binding what it always bound.
		"a --port carrying a host wins over --host": {"127.0.0.1", "0.0.0.0:9000", "0.0.0.0:9000"},
		"an IPv6 host is bracketed":                 {"::1", ":8048", "[::1]:8048"},
	} {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, testCase.want, listenAddress(testCase.host, testCase.port))
		})
	}
}

// The browser is sent here, so the token has to arrive intact whatever ZASPER_ACCESS_TOKEN holds.
func TestLoginURL(t *testing.T) {
	assert.Equal(t, "http://localhost:8048/?token=14be1b67", loginURL("0.0.0.0:8048", "14be1b67"))
	assert.Equal(t, "http://127.0.0.1:8048/?token=a+b%26c", loginURL("127.0.0.1:8048", "a b&c"))
}

func TestBrowsableURL(t *testing.T) {
	for address, want := range map[string]string{
		"127.0.0.1:8048": "http://127.0.0.1:8048",
		// A wildcard bind is not somewhere a browser can navigate, so the printed URL has to differ
		// from the bind rather than repeat it.
		"0.0.0.0:8048": "http://localhost:8048",
		"[::]:8048":    "http://localhost:8048",
		"[::1]:8048":   "http://[::1]:8048",
	} {
		t.Run(address, func(t *testing.T) {
			assert.Equal(t, want, browsableURL(address))
		})
	}
}

// The colour is only ever added around the logo: take the escapes out and the text is what it was, and
// a run where colour is off gets no escapes at all.
func TestPaintBannerOnlyAddsColour(t *testing.T) {
	escapes := regexp.MustCompile("\x1b\\[[0-9;]*m")
	all := paintBanner(strings.Join(bannerArt, "\n"), true)
	assert.Contains(t, all, bannerFill)
	assert.Contains(t, all, bannerOutline)
	for _, line := range bannerArt {
		painted := paintBanner(line, true)
		assert.True(t, strings.HasSuffix(painted, bannerReset), "a line must not leave the terminal coloured")
		assert.Equal(t, line, escapes.ReplaceAllString(painted, ""))
		assert.Equal(t, line, paintBanner(line, false))
	}
}

// The desktop app asks for its fixed port first; a taken one falls through to the next address.
func TestListenFirstSkipsATakenAddress(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer taken.Close()

	listener, err := listenFirst([]string{taken.Addr().String(), "127.0.0.1:0"})
	if err != nil {
		t.Fatalf("expected the second address to bind, got %v", err)
	}
	defer listener.Close()
	if listener.Addr().String() == taken.Addr().String() {
		t.Errorf("bound the taken address %s", taken.Addr())
	}

	if _, err := listenFirst([]string{taken.Addr().String()}); err == nil {
		t.Error("expected an error when every address is taken")
	}
}
