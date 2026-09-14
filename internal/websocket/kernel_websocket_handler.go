package websocket

import (
	"context"
	"net/http"
	"sync"

	"github.com/zasper-io/zasper/internal/core"
	zhttp "github.com/zasper-io/zasper/internal/http"
	"github.com/zasper-io/zasper/internal/kernel"

	"github.com/go-zeromq/zmq4"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"

	"github.com/rs/zerolog/log"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     zhttp.SameOrigin,
}

type kernelConnectionSet = map[*kernel.KernelWebSocketConnection]struct{}

// The client connections attached to each kernel. Several at once is normal: a notebook open in two
// tabs, or a reloaded page whose old connection has not finished closing.
var kernelConnections = struct {
	mu sync.Mutex
	by map[string]kernelConnectionSet
}{by: map[string]kernelConnectionSet{}}

// SetUpKernelConnections empties the store, for a server that is starting up.
func SetUpKernelConnections() {
	kernelConnections.mu.Lock()
	defer kernelConnections.mu.Unlock()

	kernelConnections.by = map[string]kernelConnectionSet{}
}

// The count is told to the kernel store outside this lock, because that call takes a lock of its own.
func addKernelConnection(kernelId string, connection *kernel.KernelWebSocketConnection) {
	kernelConnections.mu.Lock()
	connections := kernelConnections.by[kernelId]
	if connections == nil {
		connections = kernelConnectionSet{}
		kernelConnections.by[kernelId] = connections
	}
	connections[connection] = struct{}{}
	count := len(connections)
	kernelConnections.mu.Unlock()

	kernel.SetKernelConnections(kernelId, count)
}

// removeKernelConnection takes out this connection and no other, and says whether it was still there.
func removeKernelConnection(kernelId string, connection *kernel.KernelWebSocketConnection) bool {
	kernelConnections.mu.Lock()
	connections := kernelConnections.by[kernelId]
	_, ok := connections[connection]
	if ok {
		delete(connections, connection)
		if len(connections) == 0 {
			delete(kernelConnections.by, kernelId)
		}
	}
	count := len(connections)
	kernelConnections.mu.Unlock()

	if ok {
		kernel.SetKernelConnections(kernelId, count)
	}
	return ok
}

// CloseKernelConnections drops every client connection attached to a kernel, so notebooks stop
// listening on channels whose kernel no longer exists. Registered with kernel.OnKernelDisconnect.
func CloseKernelConnections(kernelId string) {
	kernelConnections.mu.Lock()
	connections := kernelConnections.by[kernelId]
	delete(kernelConnections.by, kernelId)
	kernelConnections.mu.Unlock()

	// Closed outside the lock: closing writes to a socket.
	for connection := range connections {
		log.Debug().Msgf("closing a client connection for kernel %s", kernelId)
		connection.Close()
	}
	if len(connections) > 0 {
		kernel.SetKernelConnections(kernelId, 0)
	}
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
	addKernelConnection(kernelId, &kernelConnection)

	log.Debug().Msg("preparing kernel connection")
	kernelConnection.Prepare(sessionId)

	log.Debug().Msg("connecting kernel")
	kernelConnection.Connect()

	var waiter sync.WaitGroup
	waiter.Add(2)

	go kernelConnection.ReadMessagesFromClient(&waiter)
	go kernelConnection.WriteMessages(&waiter)

	// Both loops return once the client goes away, whether or not the kernel is saying anything.
	waiter.Wait()
	if removeKernelConnection(kernelId, &kernelConnection) {
		log.Debug().Msgf("client for kernel %s went away", kernelId)
	}
	kernelConnection.Close()
}
