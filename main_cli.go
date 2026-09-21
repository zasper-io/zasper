//go:build !desktop

package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/logging"
)

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

	// Channel for graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	// Bind before announcing, so that a port that is already taken is the only thing printed.
	address := listenAddress(*host, *port)
	zasper, err := startServer(*cwd, address, resolveTracking(*tracking))
	if err != nil {
		log.Fatal().Err(err).Str("addr", address).Msg("could not listen; is a server already running on this port?")
	}

	printBanner(zasper.address, zasper.accessToken, version, zasper.tracking)

	if shouldOpenBrowser(*noBrowser, logging.Console(), runtime.GOOS, os.Getenv) {
		launchBrowser(loginURL(zasper.address, zasper.accessToken))
	}

	select {
	case <-stop:
	case err := <-zasper.serving:
		log.Error().Err(err).Msg("http server stopped")
	}
	// A second Ctrl-C ends the process at once, for a kernel that will not stop.
	signal.Stop(stop)
	log.Info().Msg("shutting down server")

	zasper.Stop(5 * time.Second)
	log.Info().Msg("server stopped")
}
