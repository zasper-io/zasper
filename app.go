package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os/signal"
	"syscall"
	"time"

	"net/http"
	"os"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/auth"
	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/gitclient"
	"github.com/zasper-io/zasper/internal/health"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/kernelspec"
	"github.com/zasper-io/zasper/internal/search"
	"github.com/zasper-io/zasper/internal/session"
	"github.com/zasper-io/zasper/internal/websocket"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/gorilla/mux"
	"github.com/rs/cors"
)

// Response structure to return as JSON
type InfoResponse struct {
	ProjectName string `json:"project"`
	UserName    string `json:"username"`
	OS          string `json:"os"`
	Version     string `json:"version"`
	Theme       string `json:"theme"`
	Protected   bool   `json:"protected"`
}

func InfoHandler(w http.ResponseWriter, r *http.Request) {
	theme, _ := core.GetTheme()
	response := InfoResponse{
		ProjectName: core.Zasper.ProjectName,
		UserName:    core.Zasper.UserName,
		OS:          core.Zasper.OSName,
		Version:     core.Zasper.Version,
		Theme:       theme,
		Protected:   core.Zasper.Protected,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	json.NewEncoder(w).Encode(response)

}

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

	router := mux.NewRouter()

	core.Zasper = core.SetUpZasper(version, *cwd, *protected)
	core.ZasperSession = core.SetUpActiveSessions()
	content.ZasperActiveWatcherConnections = content.SetUpActiveWatcherConnections()
	kernel.ZasperPendingKernels = kernel.SetUpStateKernels()
	kernel.ZasperActiveKernels = kernel.SetUpStateKernels()
	websocket.ZasperActiveKernelConnections = websocket.SetUpStateKernels()
	kernel.ProtocolVersion = "5.3"
	_ = analytics.SetUpPostHogClient()

	// API routes
	apiRouter := router.PathPrefix("/api").Subrouter()

	authRouter := router.PathPrefix("/auth").Subrouter()
	staticRouter := router.PathPrefix("/static").Subrouter()
	wsRouter := router.PathPrefix("/ws").Subrouter()
	if *protected {
		apiRouter.Use(auth.JwtAuthMiddleware)
	}
	apiRouter.HandleFunc("/health", health.HealthCheckHandler).Methods("GET")

	router.HandleFunc("/api/info", InfoHandler).Methods("GET")

	// config
	apiRouter.HandleFunc("/config/modify", core.ConfigModifyHandler).Methods("POST")

	authRouter.HandleFunc("/login", auth.LoginHandler).Methods("POST")

	// contents
	apiRouter.HandleFunc("/contents/create", content.ContentCreateAPIHandler).Methods("POST")
	apiRouter.HandleFunc("/contents", content.ContentAPIHandler).Methods("POST")
	apiRouter.HandleFunc("/contents", content.ContentUpdateAPIHandler).Methods("PUT")

	apiRouter.HandleFunc("/contents/rename", content.ContentRenameAPIHandler).Methods("POST")
	apiRouter.HandleFunc("/contents", content.ContentDeleteAPIHandler).Methods("DELETE")
	apiRouter.HandleFunc("/contents/watch", content.HandleWatchWebSocket).Methods("GET")
	apiRouter.HandleFunc("/contents/upload", content.UploadFileHandler).Methods("POST")

	// search
	apiRouter.HandleFunc("/files", search.GetFileSuggestions).Methods("GET")

	// git
	apiRouter.HandleFunc("/commit-graph", gitclient.CommitGraphHandler).Methods("GET")
	apiRouter.HandleFunc("/uncommitted-files", gitclient.GetUncommittedFilesHandler).Methods("GET")
	apiRouter.HandleFunc("/commit-and-maybe-push", gitclient.CommitAndMaybePushHandler).Methods("POST")
	apiRouter.HandleFunc("/current-branch", gitclient.BranchHandler).Methods("GET")

	// kernelspecs
	apiRouter.HandleFunc("/kernelspecs", kernelspec.KernelspecAPIHandler).Methods("GET")
	apiRouter.HandleFunc("/kernelspecs/{kernelName}", kernelspec.SingleKernelspecAPIHandler).Methods("GET")
	staticRouter.HandleFunc("/kernelspecs/{kernel}/{resource}", kernelspec.ServeKernelResource).Methods("GET")

	// kernels
	apiRouter.HandleFunc("/kernels", kernel.KernelListAPIHandler).Methods("GET")
	apiRouter.HandleFunc("/kernels/{kernelId}", kernel.KernelReadAPIHandler).Methods("GET")
	apiRouter.HandleFunc("/kernels/{kernelId}/interrupt", kernel.KernelInterruptAPIHandler).Methods("POST")
	apiRouter.HandleFunc("/kernels/{kernelId}/stop", kernel.KernelKillAPIHandler).Methods("POST")

	// sessions
	apiRouter.HandleFunc("/sessions", session.SessionApiHandler).Methods("GET")
	apiRouter.HandleFunc("/sessions", session.SessionCreateApiHandler).Methods("POST")

	//web sockets
	wsRouter.HandleFunc("/kernels/{kernelId}/channels", websocket.HandleWebSocket)
	wsRouter.HandleFunc("/kernels/{kernel_id}", websocket.KernelDeleteAPIHandler).Methods("DELETE")
	wsRouter.HandleFunc("/terminals/{terminalId}", websocket.HandleTerminalWebSocket)

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

	router.PathPrefix("/").Handler(getSpaHandler())

	// Track server start and stop events if tracking is enabled
	// Note that this helps me understand if the users are actually using Zasper
	// and keeps me motivated to maintain and improve the product

	if *tracking {
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
	cleanup()

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
func cleanup() {
	analytics.CloseClient()

	fmt.Println("Performing cleanup...")
	kernel.Cleanup()
}
