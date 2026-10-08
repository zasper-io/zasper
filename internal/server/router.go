// Package server holds the HTTP route table and the handlers that answer for the server itself.
package server

import (
	"net/http"
	"runtime"

	"github.com/gorilla/mux"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/config"
	"github.com/zasper-io/zasper/internal/gitclient"
	"github.com/zasper-io/zasper/internal/health"
	"github.com/zasper-io/zasper/internal/httpx"
)

// Response structure to return as JSON
type InfoResponse struct {
	ProjectName string `json:"project"`
	// The absolute path of the project directory. The name above is only its last segment, so it is
	// not an identity: two projects called `demo` in different places are the same `project`, and a
	// frontend remembering anything per project — the open tabs — needs to tell them apart.
	Directory string `json:"directory"`
	UserName  string `json:"username"`
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	Version   string `json:"version"`
	Theme     string `json:"theme"`
	// Whether widget libraries may be loaded from cdn.jsdelivr.net: Settings → Privacy.
	WidgetCDN bool `json:"widget_cdn"`
	// The file editor's defaults: Settings → Editor.
	Editor config.EditorSettings `json:"editor"`
}

type ConfigResponse struct {
	Version string `json:"version"`
}

func (s *Server) infoHandler(w http.ResponseWriter, r *http.Request) {
	// The default when the config cannot be read, which is what the frontend would fall back to anyway.
	theme, _ := config.GetTheme()
	response := InfoResponse{
		ProjectName: s.app.ProjectName,
		Directory:   s.app.HomeDir,
		UserName:    s.app.UserName,
		OS:          s.app.OSName,
		Arch:        runtime.GOARCH,
		Version:     s.app.Version,
		Theme:       theme,
		WidgetCDN:   config.WidgetCDNEnabled(),
		Editor:      config.GetEditorSettings(),
	}

	httpx.SendJSON(w, http.StatusOK, response)
}

func (s *Server) configHandler(w http.ResponseWriter, r *http.Request) {
	response := ConfigResponse{
		Version: s.app.Version,
	}

	httpx.SendJSON(w, http.StatusOK, response)
}

// websocketRoute gates a websocket handler that sits outside the /ws subrouter, so that it is
// protected on exactly the same terms as the routes inside it.
func (s *Server) websocketRoute(handler http.HandlerFunc) http.Handler {
	return s.auth.WebsocketMiddleware(handler)
}

// Router builds the route table. The SPA handler is passed in because it embeds ui/build behind a
// build tag (see spa.go / spa_apiserver.go), so a build without the frontend — a test, or the api-only
// server — has nothing to serve and passes nil.
//
// Every route but /api/health, /api/config and /auth/login needs a session: there is no unprotected
// mode to switch the gate off.
func (s *Server) Router(spa http.Handler) *mux.Router {
	router := mux.NewRouter()

	// API routes
	apiRouter := router.PathPrefix("/api").Subrouter()

	authRouter := router.PathPrefix("/auth").Subrouter()
	staticRouter := router.PathPrefix("/static").Subrouter()
	// Jupyter Server's address for a kernelspec's files, which is the one /api/kernelspecs hands out.
	kernelspecRouter := router.PathPrefix("/kernelspecs").Subrouter()
	wsRouter := router.PathPrefix("/ws").Subrouter()
	apiRouter.Use(s.auth.Middleware)
	// Kernelspec resources are read off disk by name, so they are gated like the rest of the API.
	staticRouter.Use(s.auth.Middleware)
	kernelspecRouter.Use(s.auth.Middleware)
	// The websocket routes take their token from the query string, which is the only place a browser
	// can put one.
	wsRouter.Use(s.auth.WebsocketMiddleware)
	// Sized for what the routes read. Signing in is read before anyone is authenticated, so it gets a
	// few kilobytes; the API's largest bodies are notebooks saved whole. Uploads are not capped.
	authRouter.Use(httpx.LimitBody(16 << 10))
	apiRouter.Use(httpx.LimitBody(512<<20, "/api/contents/upload"))
	router.HandleFunc("/api/health", health.HealthCheckHandler).Methods("GET")
	router.HandleFunc("/api/config", s.configHandler).Methods("GET")

	apiRouter.HandleFunc("/info", s.infoHandler).Methods("GET")

	// config
	apiRouter.HandleFunc("/config/modify", config.ConfigModifyHandler).Methods("POST")

	// telemetry. The events route is a gateway rather than a passthrough: the frontend names an event
	// and internal/analytics/events.go decides whether that is a thing Zasper sends. Both sit on
	// apiRouter, so a protected server authenticates them like every other /api route.
	apiRouter.HandleFunc("/telemetry", analytics.TelemetryHandler).Methods("POST")
	apiRouter.HandleFunc("/telemetry/settings", analytics.TelemetrySettingsHandler).Methods("GET")
	apiRouter.HandleFunc("/telemetry/settings", analytics.TelemetrySettingsModifyHandler).Methods("POST")

	if s.updates != nil {
		apiRouter.HandleFunc("/updates", s.updates.StatusHandler).Methods("GET")
		apiRouter.HandleFunc("/updates/check", s.updates.CheckHandler).Methods("POST")
		apiRouter.HandleFunc("/updates/whats-new", s.updates.WhatsNewHandler).Methods("GET")
		apiRouter.HandleFunc("/updates/whats-new/seen", s.updates.SeenHandler).Methods("POST")
	}

	authRouter.HandleFunc("/login", s.auth.Login).Methods("POST")
	authRouter.HandleFunc("/logout", s.auth.Logout).Methods("POST")

	// contents
	apiRouter.HandleFunc("/contents/create", s.content.Create).Methods("POST")
	apiRouter.HandleFunc("/contents", s.content.Read).Methods("POST")
	apiRouter.HandleFunc("/contents", s.content.Update).Methods("PUT")

	apiRouter.HandleFunc("/contents/rename", s.content.Rename).Methods("POST")
	apiRouter.HandleFunc("/contents/move", s.content.Move).Methods("POST")
	apiRouter.HandleFunc("/contents/copy", s.content.Copy).Methods("POST")
	apiRouter.HandleFunc("/contents", s.content.Delete).Methods("DELETE")
	apiRouter.HandleFunc("/contents/download", s.content.Download).Methods("GET")
	apiRouter.HandleFunc("/contents/editorconfig", s.content.EditorConfig).Methods("GET")
	apiRouter.HandleFunc("/contents/edits", s.content.Edits).Methods("POST")
	apiRouter.HandleFunc("/contents/upload", s.content.Upload).Methods("POST")

	// The watcher is a websocket that happens to live under /api, so it authenticates like the /ws
	// routes rather than by header — on apiRouter it answered 401 to a browser that had no way to send
	// one. Registered on the root router, which /api falls through to once apiRouter has no route for
	// the path, the same way /api/health does.
	router.Handle("/api/contents/watch", s.websocketRoute(s.content.Watch)).Methods("GET")

	// search
	apiRouter.HandleFunc("/files", s.search.Files).Methods("GET")
	apiRouter.HandleFunc("/search", s.search.Search).Methods("POST")
	apiRouter.HandleFunc("/search/preview", s.search.Preview).Methods("POST")
	apiRouter.HandleFunc("/search/replace", s.search.Replace).Methods("POST")
	apiRouter.HandleFunc("/search/buffer", s.search.Buffer).Methods("POST")

	// data connections for SQL cells: kept by the server, used in a kernel. Everything that reaches a
	// kernel asks for trust; listing and editing them is settings. See docs/SQL.md.
	apiRouter.HandleFunc("/connections", s.connections.ListHandler).Methods("GET")
	apiRouter.HandleFunc("/connections", s.connections.SaveHandler).Methods("PUT")
	apiRouter.HandleFunc("/connections", s.connections.DeleteHandler).Methods("DELETE")
	apiRouter.HandleFunc("/connections/prepare", s.trust.Require(s.connections.PrepareHandler)).Methods("POST")
	apiRouter.HandleFunc("/connections/schema", s.trust.Require(s.connections.SchemaHandler)).Methods("POST")
	apiRouter.HandleFunc("/connections/columns", s.trust.Require(s.connections.ColumnsHandler)).Methods("POST")
	apiRouter.HandleFunc("/connections/count", s.trust.Require(s.connections.CountHandler)).Methods("POST")
	apiRouter.HandleFunc("/connections/test", s.trust.Require(s.connections.TestHandler)).Methods("POST")
	apiRouter.HandleFunc("/kernels/{kernelId}/install", s.trust.Require(s.kernels.InstallHandler)).Methods("POST")

	// trust: whether the project's code may run, and the folders that may
	apiRouter.HandleFunc("/trust", s.trust.StateHandler).Methods("GET")
	apiRouter.HandleFunc("/trust", s.trust.TrustHandler).Methods("POST")
	apiRouter.HandleFunc("/trust", s.trust.ForgetHandler).Methods("DELETE")
	apiRouter.HandleFunc("/trust/all", s.trust.TrustAllHandler).Methods("PUT")

	// language servers
	apiRouter.HandleFunc("/lsp/servers", s.languages.Servers).Methods("GET")
	apiRouter.HandleFunc("/lsp/log", s.languages.Log).Methods("GET")

	// git
	apiRouter.HandleFunc("/git/status", s.git.Status).Methods("GET")
	apiRouter.HandleFunc("/git/log", s.git.Log).Methods("GET")
	apiRouter.HandleFunc("/git/commit/{hash}", s.git.CommitDetail).Methods("GET")
	apiRouter.HandleFunc("/git/diff", s.git.Diff).Methods("GET")
	// Everything that changes the repository asks first in a folder that is not trusted: a repository's
	// own .git/config can make git run commands — hooks, filters, credential helpers, a signing program —
	// and git has no switch that ignores it. Reading stays open. See docs/TRUST.md.
	apiRouter.HandleFunc("/git/stage", gitclient.Tracked("stage", s.trust.Require(s.git.Stage))).Methods("POST")
	apiRouter.HandleFunc("/git/unstage", gitclient.Tracked("unstage", s.trust.Require(s.git.Unstage))).Methods("POST")
	apiRouter.HandleFunc("/git/discard", gitclient.Tracked("discard", s.trust.Require(s.git.Discard))).Methods("POST")
	apiRouter.HandleFunc("/git/commit", gitclient.Tracked("commit", s.trust.Require(s.git.Commit))).Methods("POST")
	apiRouter.HandleFunc("/git/branches", s.git.Branches).Methods("GET")
	apiRouter.HandleFunc("/git/branches", gitclient.Tracked("branch_delete", s.trust.Require(s.git.DeleteBranch))).Methods("DELETE")
	apiRouter.HandleFunc("/git/checkout", gitclient.Tracked("checkout", s.trust.Require(s.git.Checkout))).Methods("POST")
	apiRouter.HandleFunc("/git/fetch", gitclient.Tracked("fetch", s.trust.Require(s.git.Fetch))).Methods("POST")
	apiRouter.HandleFunc("/git/pull", gitclient.Tracked("pull", s.trust.Require(s.git.Pull))).Methods("POST")
	apiRouter.HandleFunc("/git/push", gitclient.Tracked("push", s.trust.Require(s.git.Push))).Methods("POST")
	apiRouter.HandleFunc("/git/init", gitclient.Tracked("init", s.git.Init)).Methods("POST")
	// The status bar wants one string on boot and nothing else, so it keeps an endpoint of its own
	// rather than reading a whole status.
	apiRouter.HandleFunc("/current-branch", s.git.Branch).Methods("GET")

	// kernelspecs
	apiRouter.HandleFunc("/kernelspecs", s.specs.ListHandler).Methods("GET")
	// The Pythons Settings offers as the default interpreter, and which one is chosen.
	apiRouter.HandleFunc("/interpreters", s.specs.InterpretersHandler).Methods("GET")
	apiRouter.HandleFunc("/kernelspecs/{kernelName}", s.specs.GetHandler).Methods("GET")
	// The launcher's "Set up a Python kernel". Not Jupyter's, so not under /api/kernelspecs, where a GET
	// would be read as a kernel named "setup".
	apiRouter.HandleFunc("/environment/setup", s.specs.SetupStatusHandler).Methods("GET")
	apiRouter.HandleFunc("/environment/setup", s.specs.SetupHandler).Methods("POST")
	kernelspecRouter.HandleFunc("/{kernel}/{resource}", s.specs.ResourceHandler).Methods("GET")
	// Zasper's old address for the same files, kept for anything that learned it.
	staticRouter.HandleFunc("/kernelspecs/{kernel}/{resource}", s.specs.ResourceHandler).Methods("GET")

	// kernels
	apiRouter.HandleFunc("/kernels", s.kernels.ListHandler).Methods("GET")
	// Before /kernels/{kernelId}, which would otherwise read it as a kernel named "resources".
	apiRouter.HandleFunc("/kernels/resources", s.kernels.ResourcesHandler).Methods("GET")
	apiRouter.HandleFunc("/kernels/{kernelId}", s.kernels.GetHandler).Methods("GET")
	apiRouter.HandleFunc("/kernels/{kernelId}/interrupt", s.kernels.InterruptHandler).Methods("POST")
	apiRouter.HandleFunc("/kernels/{kernelId}/variables", s.kernels.VariablesHandler).Methods("GET")
	apiRouter.HandleFunc("/kernels/{kernelId}/variables/{name}/rows", s.kernels.RowsHandler).Methods("POST")
	apiRouter.HandleFunc("/kernels/{kernelId}/variables/{name}/profile", s.kernels.ProfileHandler).Methods("GET")
	apiRouter.HandleFunc("/kernels/{kernelId}/variables/{name}/csv", s.kernels.CSVHandler).Methods("POST")
	apiRouter.HandleFunc("/kernels/{kernelId}/variables/{name}/chart", s.kernels.ChartHandler).Methods("POST")
	apiRouter.HandleFunc("/kernels/{kernelId}/stop", s.kernels.KillHandler).Methods("POST")
	apiRouter.HandleFunc("/kernels/{kernelId}", s.kernels.KillHandler).Methods("DELETE")

	// terminals. The shells live in the terminal package because the connection is what starts and
	// ends one; these two are how anything that is not that connection can see them.
	apiRouter.HandleFunc("/terminals", s.terminals.ListHandler).Methods("GET")
	apiRouter.HandleFunc("/terminals/run-command", s.terminals.RunCommandHandler).Methods("GET")
	apiRouter.HandleFunc("/terminals/{terminalId}", s.terminals.KillHandler).Methods("DELETE")

	// sessions
	apiRouter.HandleFunc("/sessions", s.sessions.ListHandler).Methods("GET")
	apiRouter.HandleFunc("/sessions", s.sessions.CreateHandler).Methods("POST")
	apiRouter.HandleFunc("/sessions/{sessionId}", s.sessions.DeleteHandler).Methods("DELETE")

	//web sockets
	wsRouter.HandleFunc("/kernels/{kernelId}/channels", s.kernelSockets.HandleWebSocket)
	wsRouter.HandleFunc("/terminals/{terminalId}", s.terminals.HandleWebSocket)
	wsRouter.HandleFunc("/lsp/{language}", s.languages.HandleWebSocket)

	if spa != nil {
		router.PathPrefix("/").Handler(s.auth.PageGate(spa))
	}

	return router
}
