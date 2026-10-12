//go:build !desktop

package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/httpx"
	"github.com/zasper-io/zasper/internal/logging"
	"github.com/zasper-io/zasper/internal/mcpbridge"
	"github.com/zasper-io/zasper/internal/runtimeinfo"
)

func main() {
	// A command of its own, before the server's flags: an agent runs `zasper mcp` and talks MCP on stdio.
	if len(os.Args) > 1 && os.Args[1] == "mcp" {
		os.Exit(runMCP())
	}

	debug := flag.Bool("debug", false, "sets log level to debug")
	cwd := flag.String("cwd", ".", "base directory of project")
	host := flag.String("host", "127.0.0.1", "interface to bind; 0.0.0.0 puts the server on the network")
	port := flag.String("port", ":8048", "port to start the server on")
	protected := flag.Bool("protected", true, "deprecated and ignored: Zasper always runs in protected mode")
	tracking := flag.Bool("tracking", true, "enable usage tracking")
	showVersion := flag.Bool("version", false, "print the version and exit")
	checkUpdate := flag.Bool("check-update", false, "ask zasper.io for the newest version and exit: 0 when up to date, 1 when there is a newer one, 2 when the check failed")
	noBrowser := flag.Bool("no-browser", false, "do not open the app in a browser on startup")
	allowHost := flag.String("allow-host", "", "other host names a server on loopback answers to, comma-separated, such as a reverse proxy's")
	trustFolder := flag.Bool("trust", false, "trust the project folder for this run: its kernels, .venv and language servers start without asking")

	flag.Parse()

	// Before the logger and before anything binds: `zasper --version` should answer and stop, which
	// is what a package manager's smoke test and half of every bug report start with.
	if *showVersion {
		fmt.Println(resolveVersion())
		return
	}
	if *checkUpdate {
		version = resolveVersion()
		os.Exit(checkForUpdate(context.Background(), newUpdateChecker(), os.Stdout))
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

	allowedHosts, err := httpx.AllowedHosts(*allowHost, os.Getenv("ZASPER_ALLOWED_HOSTS"))
	if err != nil {
		log.Fatal().Err(err).Msg("--allow-host and ZASPER_ALLOWED_HOSTS take host names")
	}

	// Channel for graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	// Bind before announcing, so that a port that is already taken is the only thing printed.
	address := listenAddress(*host, *port)
	zasper, err := startServer(*cwd, []string{address}, resolveTracking(*tracking), allowedHosts, *trustFolder)
	if err != nil {
		log.Fatal().Err(err).Str("addr", address).Msg("could not listen; is a server already running on this port?")
	}

	printBanner(zasper.address, zasper.accessToken, version, zasper.tracking, zasper.updates.Status())

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

// runMCP is `zasper mcp`: the running server's MCP tools, on stdin and stdout. See docs/MCP.md.
func runMCP() int {
	dir, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, "zasper mcp:", err)
		return 1
	}
	servers, err := runtimeinfo.List()
	if err != nil {
		fmt.Fprintln(os.Stderr, "zasper mcp:", err)
		return 1
	}
	local := &http.Client{Timeout: 0}
	server, err := mcpbridge.Find(dir, servers, mcpbridge.Alive(&http.Client{Timeout: 2 * time.Second}))
	if err != nil {
		fmt.Fprintln(os.Stderr, "zasper mcp:", err)
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	bridge, err := mcpbridge.Connect(ctx, server, local)
	if err != nil {
		fmt.Fprintln(os.Stderr, "zasper mcp:", err)
		return 1
	}
	if err := bridge.Serve(ctx, os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "zasper mcp:", err)
		return 1
	}
	return 0
}
