package kernelws

import (
	"context"
	"net/http"
	"sync"

	"github.com/zasper-io/zasper/internal/httpx"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/session"
	"github.com/zasper-io/zasper/internal/store"

	"github.com/go-zeromq/zmq4"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"

	"github.com/rs/zerolog/log"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     httpx.SameOrigin,
}

type kernelConnectionSet = map[*Connection]struct{}

// Handler bridges notebooks' websockets to the kernels a server runs.
type Handler struct {
	kernels  *kernel.Kernels
	sessions *session.Sessions
	// The client connections attached to each kernel. Several is normal: a notebook open in two tabs, or
	// a reloaded page whose old connection has not closed yet.
	connections store.Map[string, kernelConnectionSet]
}

// NewHandler connects clients to kernels, for sessions they have joined.
func NewHandler(kernels *kernel.Kernels, sessions *session.Sessions) *Handler {
	return &Handler{kernels: kernels, sessions: sessions}
}

// The count is told to the kernels outside this lock, because that call takes a lock of its own.
func (h *Handler) addConnection(kernelId string, connection *Connection) {
	count := 0
	h.connections.With(func(all map[string]kernelConnectionSet) {
		connections := all[kernelId]
		if connections == nil {
			connections = kernelConnectionSet{}
			all[kernelId] = connections
		}
		connections[connection] = struct{}{}
		count = len(connections)
	})
	h.kernels.SetConnections(kernelId, count)
}

// removeConnection takes out this connection and no other, and says whether it was still there.
func (h *Handler) removeConnection(kernelId string, connection *Connection) bool {
	removed, count := false, 0
	h.connections.With(func(all map[string]kernelConnectionSet) {
		connections := all[kernelId]
		if _, removed = connections[connection]; removed {
			delete(connections, connection)
			if len(connections) == 0 {
				delete(all, kernelId)
			}
		}
		count = len(connections)
	})
	if removed {
		h.kernels.SetConnections(kernelId, count)
	}
	return removed
}

// CloseConnections drops every client connection attached to a kernel, so notebooks stop listening on
// channels whose kernel no longer exists. The server registers it with the kernels' OnDisconnect.
func (h *Handler) CloseConnections(kernelId string) {
	connections, _ := h.connections.Take(kernelId)

	// Closed outside the lock: closing writes to a socket.
	for connection := range connections {
		log.Debug().Msgf("closing a client connection for kernel %s", kernelId)
		connection.Close()
	}
	if len(connections) > 0 {
		h.kernels.SetConnections(kernelId, 0)
	}
}

// HandleWebSocket attaches a notebook to its session's kernel for as long as the socket stays open.
func (h *Handler) HandleWebSocket(w http.ResponseWriter, req *http.Request) {
	kernelId := mux.Vars(req)["kernelId"]
	sessionId := req.URL.Query().Get("session_id")
	log.Debug().Msgf("kernel connection requested for kernel %s, session %s", kernelId, sessionId)

	if _, ok := h.sessions.Get(sessionId); !ok {
		log.Warn().Msg("session not found")
		http.NotFound(w, req)
		return
	}

	kernelManager, ok := h.kernels.Get(kernelId)
	if !ok {
		log.Error().Msg("kernel not found")
		http.NotFound(w, req)
		return
	}

	conn, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Error().Msgf("%s", err)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())

	kernelConnection := Connection{
		KernelId:      kernelId,
		KernelManager: kernelManager,
		Channels:      make(map[string]zmq4.Socket),
		Conn:          conn,
		Send:          make(chan []byte),
		Context:       ctx,
		PollingCancel: cancel,
	}

	// Registered before it is connected: connecting dials five sockets at a kernel that may still be
	// starting, and a kernel killed in that window would otherwise leave the client socket open forever.
	h.addConnection(kernelId, &kernelConnection)

	kernelConnection.Prepare(sessionId)
	kernelConnection.Connect()

	var waiter sync.WaitGroup
	waiter.Add(2)

	go kernelConnection.ReadMessagesFromClient(&waiter)
	go kernelConnection.WriteMessages(&waiter)

	// Both loops return once the client goes away, whether or not the kernel is saying anything.
	waiter.Wait()
	if h.removeConnection(kernelId, &kernelConnection) {
		log.Debug().Msgf("client for kernel %s went away", kernelId)
	}
	kernelConnection.Close()
}
