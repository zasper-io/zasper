package main

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/zasper-io/zasper/internal/config"
	"github.com/zasper-io/zasper/internal/httpx"
	"github.com/zasper-io/zasper/internal/logging"

	"github.com/rs/cors"
	"github.com/rs/zerolog/log"
)

var version string

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
	for _, line := range bannerArt {
		fmt.Println(paintBanner(line, logging.Color()))
	}
	fmt.Println()
	fmt.Printf("                    Zasper Server\n")
	fmt.Printf("                   Version: %s\n", version)
	fmt.Println("----------------------------------------------------------")
	fmt.Println(" ✅ Server started successfully!")
	// Both lines, because they differ the moment --host is widened: the bind says who can reach the
	// server, the URL is the one a browser on this machine can actually open.
	fmt.Printf(" 📡 Bound to:            %s\n", address)
	fmt.Printf(" 🖥️  Webapp available at: %s\n", browsableURL(address))
	fmt.Printf(" 🔐 Server Access Token: %s\n", accessToken)
	fmt.Printf(" 🔗 Sign in with:        %s\n", loginURL(address, accessToken))
	fmt.Println("==========================================================")
}

var bannerArt = []string{
	"     ███████╗ █████╗ ███████╗██████╗ ███████╗██████╗ ",
	"     ╚══███╔╝██╔══██╗██╔════╝██╔══██╗██╔════╝██╔══██╗",
	"       ███╔╝ ███████║███████╗██████╔╝█████╗  ██████╔╝",
	"      ███╔╝  ██╔══██║╚════██║██╔═══╝ ██╔══╝  ██╔══██╗",
	"     ███████╗██║  ██║███████║██║     ███████╗██║  ██║",
	"     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝",
}

// The app's teal, as the nearest of the 256 xterm colours rather than as 24-bit: Terminal.app before
// macOS 26 prints 24-bit escapes as noise. The letters are teal 400 (#2c8f88 → 30) and their outline
// teal 600 (#0c6862 → 23), which both read on a light terminal and a dark one.
const (
	bannerFill    = "\x1b[38;5;30m"
	bannerOutline = "\x1b[38;5;23m"
	bannerReset   = "\x1b[0m"
)

// paintBanner colours one line of the logo: the solid blocks in the fill, the box-drawing strokes in
// the outline. Only where the colour changes, so a line is a handful of escapes rather than one per rune.
func paintBanner(line string, color bool) string {
	if !color {
		return line
	}
	var out strings.Builder
	current := ""
	for _, r := range line {
		want := current
		switch {
		case r == '█':
			want = bannerFill
		case r != ' ':
			want = bannerOutline
		}
		if want != current {
			out.WriteString(want)
			current = want
		}
		out.WriteRune(r)
	}
	if current != "" {
		out.WriteString(bannerReset)
	}
	return out.String()
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
loopback host or one of allowedHosts, which is what stops a DNS-rebound page reaching the server.
*/
func appHandler(router http.Handler, address string, allowedHosts []string) http.Handler {
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
		handler = httpx.LoopbackHostOnly(handler, allowedHosts)
	}
	return handler
}
