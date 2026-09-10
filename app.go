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
	port := flag.String("port", ":8048", "port to start the server on")
	protected := flag.Bool("protected", false, "enable protected mode")
	tracking := flag.Bool("tracking", true, "enable usage tracking")

	flag.Parse()

	// Before anything else logs, so that every line in the run has the same shape.
	logging.SetUp(*debug)

	if version == "" {
		// Only a source build reads this; a release binary has its version linked in, so a missing
		// file here is the normal case for `go run .` and not worth an error.
		data, err := os.ReadFile("version.txt")
		if err != nil {
			log.Warn().Err(err).Msg("no version.txt and no linked version; reporting version as unknown")
			version = "unknown"
		} else {
			version = strings.TrimSpace(string(data))
		}
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
	listener, err := net.Listen("tcp", *port)
	if err != nil {
		log.Fatal().Err(err).Str("addr", *port).Msg("could not listen; is a server already running on this port?")
	}

	printBanner(*port, core.ServerAccessToken, version, *protected, trackingOn)

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
func printBanner(port string, accessToken string, version string, protected bool, tracking bool) {
	if !logging.Console() {
		event := log.Info().
			Str("version", version).
			Str("addr", "http://localhost"+port).
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
	fmt.Printf(" 📡 Listening on:        http://localhost%s\n", port)
	fmt.Printf(" 🖥️  Webapp available at: http://localhost%s\n", port)
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
