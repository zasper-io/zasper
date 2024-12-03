package main

import (
	"context"
	"flag"
	"fmt"
	glog "log"
	"os/signal"
	"syscall"
	"time"

	"net/http"
	"os"
	"path/filepath"

	"github.com/zasper-io/zasper/content"
	"github.com/zasper-io/zasper/core"
	"github.com/zasper-io/zasper/gitclient"
	"github.com/zasper-io/zasper/health"
	"github.com/zasper-io/zasper/kernel"
	"github.com/zasper-io/zasper/kernelspec"
	"github.com/zasper-io/zasper/session"
	"github.com/zasper-io/zasper/websocket"

	"github.com/rs/zerolog"

	"github.com/gorilla/mux"
	"github.com/rs/cors"
)

type spaHandler struct {
	staticPath string
	indexPath  string
}

func (h spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Join internally call path.Clean to prevent directory traversal
	path := filepath.Join(h.staticPath, r.URL.Path)

	// check whether a file exists or is a directory at the given path
	fi, err := os.Stat(path)
	if os.IsNotExist(err) || fi.IsDir() {
		// file does not exist or path is a directory, serve index.html
		http.ServeFile(w, r, filepath.Join(h.staticPath, h.indexPath))
		return
	}

	if err != nil {
		// if we got an error (that wasn't that the file doesn't exist) stating the
		// file, return a 500 internal server error and stop
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// otherwise, use http.FileServer to serve the static file
	http.FileServer(http.Dir(h.staticPath)).ServeHTTP(w, r)
}
func main() {

	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	debug := flag.Bool("debug", false, "sets log level to debug")
	cwd := flag.String("cwd", ".", "base directory of project")
	port := flag.String("port", ":8888", "port to start the server on")

	flag.Parse()

	zerolog.SetGlobalLevel(zerolog.InfoLevel)
	if *debug {
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	}

	router := mux.NewRouter()

	core.Zasper = core.SetUpZasper(*cwd)
	core.ZasperSession = core.SetUpActiveSessions()
	kernel.ZasperPendingKernels = kernel.SetUpStateKernels()
	kernel.ZasperActiveKernels = kernel.SetUpStateKernels()
	kernel.ChannelSocketTypes = kernel.SetUpChannelSocketTypes()
	kernel.ProtocolVersion = "8.6.2"

	// API routes
	apiRouter := router.PathPrefix("/api").Subrouter()
	apiRouter.HandleFunc("/health", health.HealthCheckHandler).Methods("GET")

	// contents
	apiRouter.HandleFunc("/contents/create", content.ContentCreateAPIHandler).Methods("POST")

	apiRouter.HandleFunc("/commit-graph", gitclient.CommitGraphHandler).Methods("GET")
	apiRouter.HandleFunc("/uncommitted-files", gitclient.GetUncommittedFilesHandler).Methods("GET")
	apiRouter.HandleFunc("/commit-and-maybe-push", gitclient.CommitAndMaybePushHandler).Methods("POST")
	apiRouter.HandleFunc("/current-branch", gitclient.BranchHandler).Methods("GET")

	apiRouter.HandleFunc("/contents", content.ContentAPIHandler).Methods("POST")
	apiRouter.HandleFunc("/contents", content.ContentUpdateAPIHandler).Methods("PUT")

	apiRouter.HandleFunc("/contents/{path}", content.ContentRenameAPIHandler).Methods("PATCH")
	apiRouter.HandleFunc("/contents", content.ContentDeleteAPIHandler).Methods("DELETE")

	// kernelspecs
	apiRouter.HandleFunc("/kernelspecs", kernelspec.KernelspecAPIHandler).Methods("GET")
	apiRouter.HandleFunc("/kernelspecs/{kernelName}", kernelspec.SingleKernelspecAPIHandler).Methods("GET")

	// kernels
	apiRouter.HandleFunc("/kernels", kernel.KernelListAPIHandler).Methods("GET")
	apiRouter.HandleFunc("/kernels/{kernelId}", kernel.KernelReadAPIHandler).Methods("GET")

	// sessions
	apiRouter.HandleFunc("/sessions", session.SessionApiHandler).Methods("GET")
	apiRouter.HandleFunc("/sessions", session.SessionCreateApiHandler).Methods("POST")

	//web sockets
	apiRouter.HandleFunc("/kernels/{kernelId}/channels", websocket.HandleWebSocket)
	apiRouter.HandleFunc("/terminals/{terminalId}", websocket.HandleTerminalWebSocket)

	glog.Print("Zasper Server started! Listening on port", *port)

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
	spa := spaHandler{staticPath: "./ui/build", indexPath: "index.html"}
	router.PathPrefix("/").Handler(spa)

	// Channel for graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

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
	fmt.Println("Performing cleanup...")
	kernel.Cleanup()
}
