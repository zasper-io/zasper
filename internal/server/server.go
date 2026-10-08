package server

import (
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/auth"
	"github.com/zasper-io/zasper/internal/config"
	"github.com/zasper-io/zasper/internal/connections"
	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/gitclient"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/kernelspec"
	"github.com/zasper-io/zasper/internal/kernelws"
	"github.com/zasper-io/zasper/internal/lsp"
	"github.com/zasper-io/zasper/internal/search"
	"github.com/zasper-io/zasper/internal/session"
	"github.com/zasper-io/zasper/internal/terminal"
	"github.com/zasper-io/zasper/internal/trust"
	"github.com/zasper-io/zasper/internal/updates"
)

// Server is one Zasper server: the project it serves and everything that answers for it.
type Server struct {
	app           core.Application
	auth          *auth.Auth
	content       *content.Handler
	git           *gitclient.Handler
	search        *search.Handler
	specs         *kernelspec.Catalog
	kernels       *kernel.Kernels
	sessions      *session.Sessions
	kernelSockets *kernelws.Handler
	terminals     *terminal.Terminals
	languages     *lsp.Manager
	updates       *updates.Checker
	trust         *trust.Gate
	connections   *connections.Handler
}

// New builds the server for app, and connects the parts that cannot import each other.
func New(app core.Application) *Server {
	project := content.NewProject(app.HomeDir)
	specs := kernelspec.NewCatalog(app.JupyterPath, app.HomeDir)
	kernels := kernel.New(specs)
	sessions := session.New(project, kernels)

	s := &Server{
		app:           app,
		auth:          auth.New(app.AccessToken),
		content:       content.NewHandler(project),
		git:           gitclient.NewHandler(project.Root()),
		search:        search.NewHandler(project),
		specs:         specs,
		kernels:       kernels,
		sessions:      sessions,
		kernelSockets: kernelws.NewHandler(kernels, sessions),
		terminals:     terminal.New(project),
		languages:     lsp.New(project.Root()),
		trust:         trust.New(project.Root(), app.Trust),
	}

	// Until the project is trusted nothing it controls runs: see docs/TRUST.md.
	s.connections = connections.NewHandler(connections.New(project.Root()), kernels, project.Root(), specs.PythonKernelName)

	gate := s.trust
	gate.DescribeEnvironment(func() string { return kernelspec.ProjectPython(project.Root()) })
	kernels.RequireTrust(gate.Check)
	specs.RequireTrust(gate.Trusted)
	s.terminals.RequireTrust(gate.Check)
	s.languages.RequireTrust(gate.Trusted)
	s.git.RequireTrust(gate.Trusted)

	// A stopped kernel takes its sessions and its notebooks' sockets with it. Sessions go first, so that a
	// client told its socket has closed finds no session left to rejoin.
	kernels.OnDisconnect(func(kernelId string) { sessions.DeleteForKernel(kernelId) })
	kernels.OnDisconnect(s.kernelSockets.CloseConnections)
	// A run that ends with no tab open on it would otherwise leave its output only in memory.
	kernels.OnRunFinished(func(kernelId string, run kernel.Run) {
		path, ok := sessions.PathForKernel(kernelId)
		if !ok {
			return
		}
		var execution map[string]string
		if recording := config.GetEditorSettings().RecordTiming; recording != nil && *recording {
			execution = run.Execution
		}
		if err := project.WriteRunOutputs(path, run.CellID, run.Code, run.ExecutionCount, run.Outputs, execution); err != nil {
			log.Warn().Err(err).Msgf("could not write a finished run's output into %s", path)
		}
	})
	// A renamed notebook's session follows the file.
	s.content.OnMoved(func(from, to string) { sessions.Relocate(from, to) })

	return s
}

// UseUpdates gives the server the update check its /api/updates routes answer from. A server without one,
// such as a test's, has no such routes.
func (s *Server) UseUpdates(checker *updates.Checker) {
	s.updates = checker
}

// Shutdown stops every shell and kernel the server started.
func (s *Server) Shutdown() {
	s.terminals.StopAll()
	s.languages.StopAll()
	s.kernels.StopAll()
}
