package server

import (
	"github.com/zasper-io/zasper/internal/auth"
	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/gitclient"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/kernelspec"
	"github.com/zasper-io/zasper/internal/kernelws"
	"github.com/zasper-io/zasper/internal/search"
	"github.com/zasper-io/zasper/internal/session"
	"github.com/zasper-io/zasper/internal/terminal"
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
	}

	// A stopped kernel takes its sessions and its notebooks' sockets with it. Sessions go first, so that a
	// client told its socket has closed finds no session left to rejoin.
	kernels.OnDisconnect(func(kernelId string) { sessions.DeleteForKernel(kernelId) })
	kernels.OnDisconnect(s.kernelSockets.CloseConnections)
	// A renamed notebook's session follows the file.
	s.content.OnMoved(func(from, to string) { sessions.Relocate(from, to) })

	return s
}

// Shutdown stops every shell and kernel the server started.
func (s *Server) Shutdown() {
	s.terminals.StopAll()
	s.kernels.StopAll()
}
