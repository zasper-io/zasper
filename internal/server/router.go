// Package server holds the HTTP route table and the handlers that answer for the server itself.
package server

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"

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

type ConfigResponse struct {
	Version   string `json:"version"`
	Protected bool   `json:"protected"`
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

func ConfigHandler(w http.ResponseWriter, r *http.Request) {
	response := ConfigResponse{
		Version:   core.Zasper.Version,
		Protected: core.Zasper.Protected,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	json.NewEncoder(w).Encode(response)
}

// NewRouter builds the route table. The SPA handler is passed in because it embeds ui/build behind a
// build tag (see spa.go / spa_apiserver.go), so a build without the frontend — a test, or the api-only
// server — has nothing to serve and passes nil.
//
// Protected mode is read from core.Zasper, so core.SetUpZasper has to have run first.
func NewRouter(spa http.Handler) *mux.Router {
	router := mux.NewRouter()

	// API routes
	apiRouter := router.PathPrefix("/api").Subrouter()

	authRouter := router.PathPrefix("/auth").Subrouter()
	staticRouter := router.PathPrefix("/static").Subrouter()
	wsRouter := router.PathPrefix("/ws").Subrouter()
	if core.Zasper.Protected {
		apiRouter.Use(auth.JwtAuthMiddleware)
	}
	router.HandleFunc("/api/health", health.HealthCheckHandler).Methods("GET")
	router.HandleFunc("/api/config", ConfigHandler).Methods("GET")

	apiRouter.HandleFunc("/info", InfoHandler).Methods("GET")

	// config
	apiRouter.HandleFunc("/config/modify", core.ConfigModifyHandler).Methods("POST")

	authRouter.HandleFunc("/login", auth.LoginHandler).Methods("POST")

	// contents
	apiRouter.HandleFunc("/contents/create", content.ContentCreateAPIHandler).Methods("POST")
	apiRouter.HandleFunc("/contents", content.ContentAPIHandler).Methods("POST")
	apiRouter.HandleFunc("/contents", content.ContentUpdateAPIHandler).Methods("PUT")

	apiRouter.HandleFunc("/contents/rename", content.ContentRenameAPIHandler).Methods("POST")
	apiRouter.HandleFunc("/contents/move", content.ContentMoveAPIHandler).Methods("POST")
	apiRouter.HandleFunc("/contents/copy", content.ContentCopyAPIHandler).Methods("POST")
	apiRouter.HandleFunc("/contents", content.ContentDeleteAPIHandler).Methods("DELETE")
	apiRouter.HandleFunc("/contents/download", content.ContentDownloadAPIHandler).Methods("GET")
	apiRouter.HandleFunc("/contents/watch", content.HandleWatchWebSocket).Methods("GET")
	apiRouter.HandleFunc("/contents/upload", content.UploadFileHandler).Methods("POST")

	// search
	apiRouter.HandleFunc("/files", search.GetFileSuggestions).Methods("GET")

	// git
	apiRouter.HandleFunc("/git/status", gitclient.StatusHandler).Methods("GET")
	apiRouter.HandleFunc("/git/log", gitclient.LogHandler).Methods("GET")
	apiRouter.HandleFunc("/git/commit/{hash}", gitclient.CommitDetailHandler).Methods("GET")
	apiRouter.HandleFunc("/git/diff", gitclient.DiffHandler).Methods("GET")
	apiRouter.HandleFunc("/git/stage", gitclient.StageHandler).Methods("POST")
	apiRouter.HandleFunc("/git/unstage", gitclient.UnstageHandler).Methods("POST")
	apiRouter.HandleFunc("/git/discard", gitclient.DiscardHandler).Methods("POST")
	apiRouter.HandleFunc("/git/commit", gitclient.CommitHandler).Methods("POST")
	apiRouter.HandleFunc("/git/branches", gitclient.BranchesHandler).Methods("GET")
	apiRouter.HandleFunc("/git/branches", gitclient.DeleteBranchHandler).Methods("DELETE")
	apiRouter.HandleFunc("/git/checkout", gitclient.CheckoutHandler).Methods("POST")
	apiRouter.HandleFunc("/git/fetch", gitclient.FetchHandler).Methods("POST")
	apiRouter.HandleFunc("/git/pull", gitclient.PullHandler).Methods("POST")
	apiRouter.HandleFunc("/git/push", gitclient.PushHandler).Methods("POST")
	apiRouter.HandleFunc("/git/init", gitclient.InitHandler).Methods("POST")
	// The status bar wants one string on boot and nothing else, so it keeps an endpoint of its own
	// rather than reading a whole status.
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
	apiRouter.HandleFunc("/kernels/{kernelId}", kernel.KernelKillAPIHandler).Methods("DELETE")

	// sessions
	apiRouter.HandleFunc("/sessions", session.SessionApiHandler).Methods("GET")
	apiRouter.HandleFunc("/sessions", session.SessionCreateApiHandler).Methods("POST")
	apiRouter.HandleFunc("/sessions/{sessionId}", session.SessionDeleteApiHandler).Methods("DELETE")

	//web sockets
	wsRouter.HandleFunc("/kernels/{kernelId}/channels", websocket.HandleWebSocket)
	wsRouter.HandleFunc("/kernels/{kernel_id}", websocket.KernelDeleteAPIHandler).Methods("DELETE")
	wsRouter.HandleFunc("/terminals/{terminalId}", websocket.HandleTerminalWebSocket)

	if spa != nil {
		router.PathPrefix("/").Handler(spa)
	}

	return router
}
