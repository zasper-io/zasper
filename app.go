package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	glog "log"
	"os/signal"
	"syscall"
	"time"

	"net/http"
	"os"

	"github.com/zasper-io/zasper/internal/analytics"
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
}

func InfoHandler(w http.ResponseWriter, r *http.Request) {
	theme, _ := core.GetTheme()
	response := InfoResponse{
		ProjectName: core.Zasper.ProjectName,
		UserName:    core.Zasper.UserName,
		OS:          core.Zasper.OSName,
		Version:     core.Zasper.Version,
		Theme:       theme,
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

	flag.Parse()

	zerolog.SetGlobalLevel(zerolog.InfoLevel)
	if *debug {
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	}

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

	core.Zasper = core.SetUpZasper(version, *cwd)
	core.ZasperSession = core.SetUpActiveSessions()
	content.ZasperActiveWatcherConnections = content.SetUpActiveWatcherConnections()
	kernel.ZasperPendingKernels = kernel.SetUpStateKernels()
	kernel.ZasperActiveKernels = kernel.SetUpStateKernels()
	websocket.ZasperActiveKernelConnections = websocket.SetUpStateKernels()
	kernel.ProtocolVersion = "5.3"
	_ = analytics.SetUpPostHogClient()

	// API routes
	apiRouter := router.PathPrefix("/api").Subrouter()
	apiRouter.HandleFunc("/health", health.HealthCheckHandler).Methods("GET")

	apiRouter.HandleFunc("/info", InfoHandler).Methods("GET")

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
	apiRouter.HandleFunc("/kernelspecs/{kernel}/{resource}", kernelspec.ServeKernelResource).Methods("GET")

	// kernels
	apiRouter.HandleFunc("/kernels", kernel.KernelListAPIHandler).Methods("GET")
	apiRouter.HandleFunc("/kernels/{kernelId}", kernel.KernelReadAPIHandler).Methods("GET")

	// sessions
	apiRouter.HandleFunc("/sessions", session.SessionApiHandler).Methods("GET")
	apiRouter.HandleFunc("/sessions", session.SessionCreateApiHandler).Methods("POST")

	//web sockets
	apiRouter.HandleFunc("/kernels/{kernelId}/channels", websocket.HandleWebSocket)
	apiRouter.HandleFunc("/kernels/{kernel_id}", websocket.KernelDeleteAPIHandler).Methods("DELETE")
	apiRouter.HandleFunc("/terminals/{terminalId}", websocket.HandleTerminalWebSocket)

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

	analytics.TrackEvent("server_started", map[string]interface{}{"source": "web"})

	// Channel for graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	fmt.Println(`
███████╗ █████╗ ███████╗██████╗ ███████╗██████╗
╚══███╔╝██╔══██╗██╔════╝██╔══██╗██╔════╝██╔══██╗
  ███╔╝ ███████║███████╗██████╔╝█████╗  ██████╔╝
 ███╔╝  ██╔══██║╚════██║██╔═══╝ ██╔══╝  ██╔══██╗
███████╗██║  ██║███████║██║     ███████╗██║  ██║
╚══════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝
	`)
	fmt.Printf("Version: %s\n", core.Zasper.Version)
	glog.Println("Zasper Server started! Listening on port", *port)
	url := "http://localhost" + *port
	glog.Printf("Visit Zasper webapp on %s", url)

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

// cleanup performs cleanup operations
func cleanup() {
	analytics.TrackEvent("server_shutdown", map[string]interface{}{"source": "web"})
	fmt.Println("Performing cleanup...")
	kernel.Cleanup()
}
