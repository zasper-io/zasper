package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/zasper-io/zasper/core"
	"github.com/zasper-io/zasper/kernel"

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

var clientsMu sync.Mutex // To handle concurrent access to clients

var ZasperActiveKernelConnections map[string]*KernelWebSocketConnection

func SetUpStateKernels() map[string]*KernelWebSocketConnection {
	return make(map[string]*KernelWebSocketConnection)
}

// DELETE handler for /api/kernels/{kernel_id}
func KernelDeleteAPIHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	kernelID := vars["kernel_id"]

	kwsConn := ZasperActiveKernelConnections[kernelID]

	kwsConn.PollingCancel()

	clientsMu.Lock()
	delete(ZasperActiveKernelConnections, kernelID)
	clientsMu.Unlock()

	// Try to delete the kernel from "database"
	err := kernel.KillKernelById(kernelID)
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
	log.Info().Msg("receieved kernel connection request")
	vars := mux.Vars(req)
	kernelId := vars["kernelId"]
	log.Info().Msgf("kernelName : %s", kernelId)

	sessionId := req.URL.Query().Get("session_id")
	log.Info().Msgf("sessionId : %s", sessionId)

	session, ok := core.ZasperSession[sessionId]
	log.Info().Msgf("session %v", session)
	if !ok {
		log.Info().Msg("session not found")
		http.NotFound(w, req)
		return
	}

	kernelManager, ok := kernel.ZasperActiveKernels[kernelId]

	if !ok {
		log.Info().Msg("kernel not found")
		http.NotFound(w, req)
		return
	}

	conn, err := upgrader.Upgrade(w, req, nil)

	if err != nil {
		log.Info().Msgf("%s", err)
		return
	}

	// Create a new context for the polling operation
	ctx, cancel := context.WithCancel(context.Background())

	kernelConnection := KernelWebSocketConnection{
		KernelId:      kernelId,
		KernelManager: kernelManager,
		Channels:      make(map[string]zmq4.Socket),
		Conn:          conn,
		Send:          make(chan []byte),
		Context:       ctx,
		PollingCancel: cancel, // Store the cancel function so it can be called later to stop polling
	}

	log.Info().Msg("preparing kernel connection")
	kernelConnection.prepare(sessionId)

	log.Info().Msg("connecting kernel")
	kernelConnection.connect()

	clientsMu.Lock()
	ZasperActiveKernelConnections[kernelId] = &kernelConnection
	clientsMu.Unlock()

	var waiter sync.WaitGroup
	waiter.Add(2)

	go kernelConnection.readMessagesFromClient(&waiter)
	go kernelConnection.writeMessages(&waiter)
}

func (kwsConn *KernelWebSocketConnection) readMessagesFromClient(waiter *sync.WaitGroup) {
	defer func() {
		log.Info().Msg("Closing readMessagesFromClient")
		kwsConn.Conn.Close()
		waiter.Done()
	}()

	for {
		select {
		case <-kwsConn.Context.Done(): // Check if context is canceled
			log.Debug().Msgf("Socket closed, Incoming message handler stopped")
			return
		default:
			messageType, data, err := kwsConn.Conn.ReadMessage()
			if err != nil {
				log.Debug().Msgf("%s", err)
				return
			}
			log.Debug().Msgf("message type => %d", messageType)
			kwsConn.handleIncomingMessage(messageType, data)
		}

	}
}

func (kwsConn *KernelWebSocketConnection) writeMessages(waiter *sync.WaitGroup) {
	defer func() {
		kwsConn.Conn.Close()
		waiter.Done()
	}()
	for {
		select {
		case <-kwsConn.Context.Done(): // Check if context is canceled
			log.Debug().Msgf("Socket closed, Incoming message handler stopped")
			return
		default:
			message, ok := <-kwsConn.Send
			if !ok {
				log.Info().Msg("Send channel closed, closing WebSocket connection")
				kwsConn.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			kwsConn.mu.Lock()
			if err := kwsConn.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Info().Msgf("Error writing message: %s", err)
				return
			}
			kwsConn.mu.Unlock()
		}
	}
}
