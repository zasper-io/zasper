package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/kernel"

	"github.com/go-zeromq/zmq4"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"

	"github.com/rs/zerolog/log"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

// Response structure for consistent API responses
type APIResponse struct {
	Message string `json:"message"`
}

// The client connection attached to each kernel. The map was exported and guarded by a package-level
// mutex the caller had to remember; it is unexported and carries its own lock instead.
var kernelConnections = struct {
	mu sync.Mutex
	by map[string]*kernel.KernelWebSocketConnection
}{by: map[string]*kernel.KernelWebSocketConnection{}}

// SetUpKernelConnections empties the store, for a server that is starting up.
func SetUpKernelConnections() {
	kernelConnections.mu.Lock()
	defer kernelConnections.mu.Unlock()

	kernelConnections.by = map[string]*kernel.KernelWebSocketConnection{}
}

func setKernelConnection(kernelId string, connection *kernel.KernelWebSocketConnection) {
	kernelConnections.mu.Lock()
	defer kernelConnections.mu.Unlock()

	kernelConnections.by[kernelId] = connection
}

// removeKernelConnection takes a connection out and says whether it was the one that took it out, so
// that it is closed once. Closing is left to the caller: it writes to a socket, which the lock has no
// business waiting on.
func removeKernelConnection(kernelId string) (*kernel.KernelWebSocketConnection, bool) {
	kernelConnections.mu.Lock()
	defer kernelConnections.mu.Unlock()

	connection, ok := kernelConnections.by[kernelId]
	if ok {
		delete(kernelConnections.by, kernelId)
	}
	return connection, ok
}

// CloseKernelConnections drops every client connection attached to a kernel, so
// notebooks stop listening on channels whose kernel no longer exists. Registered
// with kernel.OnKernelDisconnect at startup.
func CloseKernelConnections(kernelId string) {
	kwsConn, ok := removeKernelConnection(kernelId)
	if !ok {
		return
	}

	log.Debug().Msgf("closing client connection for kernel %s", kernelId)
	kwsConn.Close()
}

func KernelDeleteAPIHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	kernelID := vars["kernel_id"]

	// Client connections are closed by the disconnect hook this package registers.
	err := kernel.KillKernelById(kernelID)

	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		// If the kernel is not found, respond with 404
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(APIResponse{Message: err.Error()})
		return
	}

	// If deletion is successful, respond with 200 OK
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(APIResponse{Message: fmt.Sprintf("Kernel with ID %s deleted successfully.", kernelID)})
}

func HandleWebSocket(w http.ResponseWriter, req *http.Request) {
	log.Debug().Msg("receieved kernel connection request")
	vars := mux.Vars(req)
	kernelId := vars["kernelId"]
	sessionId := req.URL.Query().Get("session_id")

	log.Debug().Msgf("kernelName : %s, sessionId : %s", kernelId, sessionId)

	session, ok := core.GetSession(sessionId)

	log.Debug().Msgf("session %v", session)
	if !ok {
		log.Warn().Msg("session not found")
		http.NotFound(w, req)
		return
	}

	kernelManager, ok := kernel.ActiveKernel(kernelId)

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

	// Create a new context for the polling operation
	ctx, cancel := context.WithCancel(context.Background())

	kernelConnection := kernel.KernelWebSocketConnection{
		KernelId:      kernelId,
		KernelManager: kernelManager,
		Channels:      make(map[string]zmq4.Socket),
		Conn:          conn,
		Send:          make(chan []byte),
		Context:       ctx,
		PollingCancel: cancel, // Store the cancel function so it can be called later to stop polling
	}

	// Registered before it is connected, not after: connecting dials five sockets at a kernel that may
	// still be starting, and a kernel killed in that window left the client socket open forever on
	// channels that no longer had a kernel behind them.
	setKernelConnection(kernelId, &kernelConnection)

	log.Debug().Msg("preparing kernel connection")
	kernelConnection.Prepare(sessionId)

	log.Debug().Msg("connecting kernel")
	kernelConnection.Connect()

	var waiter sync.WaitGroup
	waiter.Add(2)

	go kernelConnection.ReadMessagesFromClient(&waiter)
	go kernelConnection.WriteMessages(&waiter)
}
