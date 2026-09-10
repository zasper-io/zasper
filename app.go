package main

import (
	"context"
	"flag"
	"fmt"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"net"
	"net/http"
	"os"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/logging"
	"github.com/zasper-io/zasper/internal/server"

	"github.com/rs/zerolog/log"

	"github.com/rs/cors"
)

var version string

func main() {

	debug := flag.Bool("debug", false, "sets log level to debug")
	cwd := flag.String("cwd", ".", "base directory of project")
	host := flag.String("host", "127.0.0.1", "interface to bind; 0.0.0.0 puts the server on the network")
	port := flag.String("port", ":8048", "port to start the server on")
	protected := flag.Bool("protected", false, "enable protected mode")
	tracking := flag.Bool("tracking", true, "enable usage tracking")
	showVersion := flag.Bool("version", false, "print the version and exit")

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

	core.Zasper = core.SetUpZasper(version, *cwd, *protected)
	server.SetUp()

	router := server.NewRouter(getSpaHandler())

	// In a release build this process serves the SPA itself, so the app is same-origin and needs no
	// CORS at all; the list below is for `make dev`, where vite serves the frontend on 3000. It was a
	// wildcard, which let any page the user happened to have open read and write the whole project.
	corsOpts := cors.New(cors.Options{
		AllowedOrigins: []string{"http://localhost:3000", "http://127.0.0.1:3000"},
		AllowedMethods: []string{
			http.MethodGet, //http methods for your app
			http.MethodPost,
			http.MethodPut,
			http.MethodPatch,
			http.MethodDelete,
			http.MethodOptions,
			http.MethodHead,
		},

		AllowedHeaders: []string{
			"*", //or you can your header key values which you are using in your application
		},
	})

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

	// The server answers /api/contents and opens terminals, so binding it to the network without a
	// token hands a shell to anyone who can reach the port. Loopback is the default; going wider is a
	// deliberate act that deserves to be said out loud.
	if !isLoopback(address) && !*protected {
		log.Warn().Str("addr", address).
			Msg("bound to a non-loopback address with protected mode off: anyone who can reach this port can read and write the project and open a terminal. Use --protected, or --host 127.0.0.1")
	}

	printBanner(address, core.ServerAccessToken, version, *protected, trackingOn)

	go func() {
		handler := server.WithRequestLogging(log.Logger, logging.AccessLog(), corsOpts.Handler(router))
		if err := http.Serve(listener, handler); err != nil && err != http.ErrServerClosed {
			log.Error().Err(err).Msg("http server stopped")
		}
	}()

	<-stop
	log.Info().Msg("shutting down server")

	// Cleanup function
	cleanup(trackingOn)

	// Shutdown the server gracefully
	_, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	log.Info().Msg("server exiting")
}

// printBanner announces the server to whoever is reading. A person at a terminal gets the banner;
// output that is being collected as JSON gets the same facts as one structured line, because ASCII
// art in a log collector is neither readable nor parseable.
func printBanner(address string, accessToken string, version string, protected bool, tracking bool) {
	if !logging.Console() {
		event := log.Info().
			Str("version", version).
			Str("addr", address).
			Str("url", browsableURL(address)).
			Bool("protected", protected).
			Bool("tracking", tracking)
		if protected {
			// Without it a headless run has no way to authenticate, which is the same trade Jupyter makes.
			event = event.Str("access_token", accessToken)
		}
		event.Msg("zasper server started")
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
	if protected {
		fmt.Println(" 🔒 Protected Mode:      enabled")
		fmt.Printf(" 🔐 Server Access Token: %s\n", accessToken)
	} else {
		fmt.Println(" 🔒 Protected Mode:      disabled")
	}
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

// isLoopback answers whether an address is only reachable from this machine. A hostname that is not
// an IP is treated as non-loopback unless it is localhost, since resolving it here would say more
// about DNS than about what was bound.
func isLoopback(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
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

	stored, _ := core.TelemetryPreference()
	return stored
}

// cleanup performs cleanup operations
func cleanup(tracking bool) {
	if tracking {
		analytics.CloseClient()
	}
	log.Debug().Msg("performing cleanup")
	kernel.Cleanup()
}
