package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/logging"
	"github.com/zasper-io/zasper/internal/server"
)

// zasperServer is a Zasper server that is bound and serving. The CLI and the desktop app both start
// one; only what they do around it differs.
type zasperServer struct {
	// address is what the listener actually bound, so a port of 0 comes back as the real port.
	address     string
	accessToken string
	tracking    bool
	// serving receives the error that stopped Serve, if it stops before Stop is called.
	serving <-chan error

	httpServer *http.Server
	zasper     *server.Server
}

/*
startServer binds the first of addresses it can and serves the app for the project in cwd.

It returns once the listener is bound, not once the first request is served: a request that arrives
before Serve is running waits in the listener's backlog, so the caller can open a page straight away.
*/
func startServer(cwd string, addresses []string, tracking bool) (*zasperServer, error) {
	app := core.NewApplication(version, cwd)
	zasper := server.New(app)
	router := zasper.Router(getSpaHandler())

	// Anonymous usage tracking. It is what tells me whether anyone is actually using Zasper, which is
	// most of what keeps me maintaining it. Nothing that identifies a person or names a file leaves
	// the machine — internal/analytics/events.go is the list of what does, and PRIVACY.md says the
	// same thing in prose.
	if tracking {
		analytics.SetUpPostHogClient(version)
		analytics.TrackServerStart()
	} else {
		analytics.DisableForSession()
	}

	listener, err := listenFirst(addresses)
	if err != nil {
		if tracking {
			analytics.CloseClient()
		}
		zasper.Shutdown()
		return nil, err
	}
	bound := listener.Addr().String()

	httpServer := &http.Server{
		Handler: server.WithRequestLogging(log.Logger, logging.AccessLog(), appHandler(router, bound)),
		// Only the headers are timed: a whole-request or write timeout would cut off a long upload, a
		// large download and every websocket.
		ReadHeaderTimeout: 10 * time.Second,
		// A kept-alive connection with nothing on it is closed after this rather than held forever.
		IdleTimeout: 2 * time.Minute,
	}
	serving := make(chan error, 1)
	go func() { serving <- httpServer.Serve(listener) }()

	return &zasperServer{
		address:     bound,
		accessToken: app.AccessToken,
		tracking:    tracking,
		serving:     serving,
		httpServer:  httpServer,
		zasper:      zasper,
	}, nil
}

// Stop lets running requests finish for up to timeout, then stops the shells and kernels.
func (s *zasperServer) Stop(timeout time.Duration) {
	shutDown(s.httpServer, timeout, func() { cleanup(s.zasper, s.tracking) })
}

/*
shutDown stops the server in the order that loses nothing. The listener closes and requests already
running, such as a save, are given until timeout to finish. Only then do cleanup's shells and kernels
stop: they live on hijacked connections, which Shutdown neither waits for nor closes.
*/
func shutDown(httpServer *http.Server, timeout time.Duration, cleanup func()) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Warn().Err(err).Msg("stopped waiting for requests that were still running")
	}
	cleanup()
}

// cleanup stops what outlives the HTTP server: the analytics client, the shells and the kernels.
func cleanup(zasper *server.Server, tracking bool) {
	if tracking {
		analytics.CloseClient()
	}
	log.Debug().Msg("performing cleanup")
	zasper.Shutdown()
}

// listenFirst binds the first address that is free, and answers the last one's error when none is.
func listenFirst(addresses []string) (net.Listener, error) {
	err := errors.New("no address to listen on")
	for _, address := range addresses {
		var listener net.Listener
		if listener, err = net.Listen("tcp", address); err == nil {
			return listener, nil
		}
	}
	return nil, err
}
