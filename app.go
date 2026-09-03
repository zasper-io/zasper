package main

import (
	"context"
	"flag"
	"fmt"
	"os/signal"
	"syscall"
	"time"

	"net/http"
	"os"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/server"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/rs/cors"
)

var version string

func main() {

	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	debug := flag.Bool("debug", false, "sets log level to debug")
	cwd := flag.String("cwd", ".", "base directory of project")
	port := flag.String("port", ":8048", "port to start the server on")
	protected := flag.Bool("protected", false, "enable protected mode")
	tracking := flag.Bool("tracking", true, "enable usage tracking")

	flag.Parse()

	zerolog.SetGlobalLevel(zerolog.InfoLevel)
	if *debug {
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	}

	// Optional: shorten file path
	zerolog.CallerMarshalFunc = func(pc uintptr, file string, line int) string {
		return fmt.Sprintf("%s:%d", file, line)
	}

	// Enable caller + timestamp
	log.Logger = zerolog.New(os.Stdout).
		With().
		Timestamp().
		Caller().
		Logger()

	if version == "" {
		data, err := os.ReadFile("version.txt")
		if err != nil {
			log.Error().Msgf("Error reading version file: %v", err)
			version = "unknown"
		} else {
			version = string(data)
		}
	}

	core.Zasper = core.SetUpZasper(version, *cwd, *protected)
	server.SetUp()

	router := server.NewRouter(getSpaHandler())

	//cors optionsGoes Below
	corsOpts := cors.New(cors.Options{
		AllowedOrigins: []string{"*"}, //you service is available and allowed for this base url
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

	// Track server start and stop events if tracking is enabled
	// Note that this helps me understand if the users are actually using Zasper
	// and keeps me motivated to maintain and improve the product

	if *tracking {
		analytics.SetUpPostHogClient()
		analytics.TrackServerStartStopEvent("server_started", map[string]interface{}{"source": "web"})
	}

	// Channel for graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	printBanner(*port, core.ServerAccessToken, version, *protected, *tracking)

	go func() {
		if err := http.ListenAndServe(*port, corsOpts.Handler(router)); err != nil && err != http.ErrServerClosed {
			fmt.Printf("ListenAndServe(): %s\n", err)
		}
	}()

	<-stop
	fmt.Println("Shutting down server...")

	// Cleanup function
	cleanup(*tracking)

	// Shutdown the server gracefully
	_, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	fmt.Println("Server exiting")
}

func printBanner(port string, accessToken string, version string, protected bool, tracking bool) {
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
	fmt.Println(" 🔄 Server start/shutdown tracking enabled:", tracking)
	fmt.Println("==========================================================")
}

// cleanup performs cleanup operations
func cleanup(tracking bool) {
	if tracking {
		analytics.CloseClient()
	}
	fmt.Println("Performing cleanup...")
	kernel.Cleanup()
}
