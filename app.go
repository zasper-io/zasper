package main

import (
	"context"
	"flag"
	"fmt"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"net"
	"net/http"
	"net/url"
	"os"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/config"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/httpx"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/logging"
	"github.com/zasper-io/zasper/internal/server"
	"github.com/zasper-io/zasper/internal/terminal"

	"github.com/rs/zerolog/log"

	"github.com/rs/cors"
)

var version string

func main() {

	debug := flag.Bool("debug", false, "sets log level to debug")
	cwd := flag.String("cwd", ".", "base directory of project")
	host := flag.String("host", "127.0.0.1", "interface to bind; 0.0.0.0 puts the server on the network")
	port := flag.String("port", ":8048", "port to start the server on")
	protected := flag.Bool("protected", true, "deprecated and ignored: Zasper always runs in protected mode")
	tracking := flag.Bool("tracking", true, "enable usage tracking")
	showVersion := flag.Bool("version", false, "print the version and exit")
	noBrowser := flag.Bool("no-browser", false, "do not open the app in a browser on startup")

	flag.Parse()

	// Before the logger and before anything binds: `zasper --version` should answer and stop, which
	// is what a package manager's smoke test and half of every bug report start with.
	if *showVersion {
		fmt.Println(resolveVersion())
		return
	}

	// Before anything else logs, so that every line in the run has the same shape.
	logging.SetUp(*debug)

	version = resolveVersion()
	if version == "unknown" {
		log.Warn().Msg("no version.txt and no linked version; reporting version as unknown")
	}

	// Still parsed, so that a script passing it keeps starting; it just no longer switches anything off.
	if !*protected {
		log.Warn().Msg("--protected=false is ignored: Zasper always runs in protected mode")
	}

	core.Zasper = core.SetUpZasper(version, *cwd)
	server.SetUp()

	router := server.NewRouter(getSpaHandler())

	// Anonymous usage tracking. It is what tells me whether anyone is actually using Zasper, which is
	// most of what keeps me maintaining it. Nothing that identifies a person or names a file leaves
	// the machine — internal/analytics/events.go is the list of what does, and PRIVACY.md says the
	// same thing in prose.
	trackingOn := resolveTracking(*tracking)
	if trackingOn {
		analytics.SetUpPostHogClient()
		analytics.TrackServerStart()
	} else {
		analytics.DisableForSession()
	}

	// Channel for graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	// Bind before announcing. ListenAndServe did both at once inside the goroutine, so a port that was
	// already taken printed "Server started successfully!" and the real error underneath it.
	address := listenAddress(*host, *port)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		log.Fatal().Err(err).Str("addr", address).Msg("could not listen; is a server already running on this port?")
	}

	printBanner(address, core.ServerAccessToken, version, trackingOn)

	httpServer := &http.Server{
		Handler: server.WithRequestLogging(log.Logger, logging.AccessLog(), appHandler(router, address)),
		// Only the headers are timed: a whole-request or write timeout would cut off a long upload, a
		// large download and every websocket.
		ReadHeaderTimeout: 10 * time.Second,
		// A kept-alive connection with nothing on it is closed after this rather than held forever.
		IdleTimeout: 2 * time.Minute,
	}
	serving := make(chan error, 1)
	go func() { serving <- httpServer.Serve(listener) }()

	// After the bind, so the page never races the server: a request that arrives before Serve is
	// running waits in the listener's backlog.
	if shouldOpenBrowser(*noBrowser, logging.Console(), runtime.GOOS, os.Getenv) {
		launchBrowser(loginURL(address, core.ServerAccessToken))
	}

	select {
	case <-stop:
	case err := <-serving:
		log.Error().Err(err).Msg("http server stopped")
	}
	// A second Ctrl-C ends the process at once, for a kernel that will not stop.
	signal.Stop(stop)
	log.Info().Msg("shutting down server")

	shutDown(httpServer, 5*time.Second, func() { cleanup(trackingOn) })
	log.Info().Msg("server stopped")
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

// printBanner announces the server to whoever is reading. A person at a terminal gets the banner;
// output that is being collected as JSON gets the same facts as one structured line, because ASCII
// art in a log collector is neither readable nor parseable.
func printBanner(address string, accessToken string, version string, tracking bool) {
	if !logging.Console() {
		log.Info().
			Str("version", version).
			Str("addr", address).
			Str("url", browsableURL(address)).
			// Without it a headless run has no way to authenticate, which is the same trade Jupyter makes.
			Str("access_token", accessToken).
			Bool("tracking", tracking).
			Msg("zasper server started")
		return
	}

	fmt.Println("==========================================================")
	fmt.Println("     ███████╗ █████╗ ███████╗██████╗ ███████╗██████╗ ")
	fmt.Println("     ╚══███╔╝██╔══██╗██╔════╝██╔══██╗██╔════╝██╔══██╗")
	fmt.Println("       ███╔╝ ███████║███████╗██████╔╝█████╗  ██████╔╝")
	fmt.Println("      ███╔╝  ██╔══██║╚════██║██╔═══╝ ██╔══╝  ██╔══██╗")
	fmt.Println("     ███████╗██║  ██║███████║██║     ███████╗██║  ██║")
	fmt.Println("     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝")
	fmt.Println()
	fmt.Printf("                    Zasper Server\n")
	fmt.Printf("                Version: %s\n", version)
	fmt.Println("----------------------------------------------------------")
	fmt.Println(" ✅ Server started successfully!")
	// Both lines, because they differ the moment --host is widened: the bind says who can reach the
	// server, the URL is the one a browser on this machine can actually open.
	fmt.Printf(" 📡 Bound to:            %s\n", address)
	fmt.Printf(" 🖥️  Webapp available at: %s\n", browsableURL(address))
	fmt.Printf(" 🔐 Server Access Token: %s\n", accessToken)
	fmt.Printf(" 🔗 Sign in with:        %s\n", loginURL(address, accessToken))
	if tracking {
		fmt.Println(" 📊 Anonymous usage data: on  (--tracking=false to turn off)")
		fmt.Println("                          see PRIVACY.md for what is sent")
	} else {
		fmt.Println(" 📊 Anonymous usage data: off")
	}
	fmt.Println("==========================================================")
}

// resolveVersion answers what this build calls itself: the string linked in at release time, or
// version.txt for a build from source, which is the normal case for `go run .`.
func resolveVersion() string {
	if version != "" {
		return version
	}

	data, err := os.ReadFile("version.txt")
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(data))
}

/*
listenAddress works out what to bind from --host and --port.

--port has always been a ":8048"-shaped string that net.Listen read as every interface, which is how
a local notebook IDE ended up reachable from the rest of the network. --host now decides the
interface and defaults to loopback. A --port that already carries a host still wins outright, so a
command someone already has in a script binds exactly what it did before.
*/
func listenAddress(host, port string) string {
	if h, p, err := net.SplitHostPort(port); err == nil && h != "" {
		return net.JoinHostPort(h, p)
	}
	return net.JoinHostPort(host, strings.TrimPrefix(port, ":"))
}

// loginURL is the link that signs a browser in on arrival, `/?token=` as in Jupyter. The server never
// reads it: the frontend trades the token at /auth/login and takes it back out of the address bar.
func loginURL(address, accessToken string) string {
	return browsableURL(address) + "/?token=" + url.QueryEscape(accessToken)
}

// browsableURL turns a bind address into one a browser on this machine can open. 0.0.0.0 and :: are
// not somewhere you can navigate to, so a wildcard bind is shown as localhost.
func browsableURL(address string) string {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return "http://" + address
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	return "http://" + net.JoinHostPort(host, port)
}

// resolveTracking decides whether this run sends anything, highest precedence first: the --tracking
// flag, then ZASPER_TELEMETRY, then the stored choice, then on. The two per-run switches come first
// so that someone who has to demonstrate an offline or air-gapped run can get one without editing a
// config file they may not own.
func resolveTracking(flagValue bool) bool {
	if !flagValue {
		return false
	}

	switch strings.ToLower(strings.TrimSpace(os.Getenv("ZASPER_TELEMETRY"))) {
	case "0", "false", "off", "no":
		return false
	case "1", "true", "on", "yes":
		return true
	}

	stored, _ := config.TelemetryPreference()
	return stored
}

/*
appHandler wraps the route table in what every request meets first.

CORS is only for `make dev`, where vite serves the frontend on 3000 while this process serves the API.
A release build serves its own page and has no dev origins, so it gets no CORS handler at all: rs/cors
reads an empty list of origins as every origin. On a loopback bind, a request also has to name a
loopback host, which is what stops a DNS-rebound page reaching the server.
*/
func appHandler(router http.Handler, address string) http.Handler {
	handler := router
	if origins := httpx.DevOrigins(); len(origins) > 0 {
		handler = cors.New(cors.Options{
			AllowedOrigins: origins,
			AllowedMethods: []string{
				http.MethodGet,
				http.MethodPost,
				http.MethodPut,
				http.MethodPatch,
				http.MethodDelete,
				http.MethodOptions,
				http.MethodHead,
			},
			AllowedHeaders: []string{"*"},
			// The session is a cookie, which a cross-origin fetch sends and receives only with credentials.
			AllowCredentials: true,
		}).Handler(handler)
	}
	if httpx.IsLoopbackBind(address) {
		handler = httpx.LoopbackHostOnly(handler)
	}
	return handler
}

// cleanup performs cleanup operations
func cleanup(tracking bool) {
	if tracking {
		analytics.CloseClient()
	}
	log.Debug().Msg("performing cleanup")
	terminal.StopTerminals()
	kernel.Cleanup()
}
