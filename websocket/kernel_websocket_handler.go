package websocket

import (
	"net/http"
	"sync"

	"github.com/zasper-io/zasper/core"
	"github.com/zasper-io/zasper/kernel"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/pebbe/zmq4"

	"github.com/rs/zerolog/log"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

var (
	clients   = make(map[*KernelWebSocketConnection]bool) // All connected clients
	clientsMu sync.Mutex                                  // To handle concurrent access to clients
	broadcast = make(chan []byte)                         // Broadcast channel for messages
)

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

	// defer conn.Close()

	// handle websocket messages

	kernelConnection := KernelWebSocketConnection{
		KernelId:      kernelId,
		KernelManager: kernelManager,
		Channels:      make(map[string]*zmq4.Socket),
		Conn:          conn,
		Send:          make(chan []byte),
	}

	log.Info().Msg("preparing kernel connection")
	kernelConnection.prepare(sessionId)

	log.Info().Msg("connecting kernel")
	kernelConnection.connect()

	clientsMu.Lock()
	clients[&kernelConnection] = true
	clientsMu.Unlock()

	go kernelConnection.readMessages()
	go kernelConnection.writeMessages()
}

func (kwsConn *KernelWebSocketConnection) readMessages() {
	defer func() {
		kwsConn.Conn.Close()
		delete(clients, kwsConn)
	}()

	for {
		messageType, data, err := kwsConn.Conn.ReadMessage()
		if err != nil {
			log.Debug().Msgf("%s", err)
			return
		}
		log.Debug().Msgf("message type => %s", messageType)
		kwsConn.handleIncomingMessage(messageType, data)
		// broadcast <- message // Send message to broadcast channel
	}
}

func (kwsConn *KernelWebSocketConnection) writeMessages() {
	defer kwsConn.Conn.Close()
	for {
		message, ok := <-kwsConn.Send
		if !ok {
			kwsConn.Conn.WriteMessage(websocket.CloseMessage, []byte{})
			return
		}
		if err := kwsConn.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			log.Info().Msgf("Error writing message: %s", err)
			return
		}
	}
}

func handleMessages() {
	for {
		message := <-broadcast
		// Send message to all connected clients
		for client := range clients {
			select {
			case client.Send <- message:
			default:
				close(client.Send)
				delete(clients, client)
			}
		}
	}
}
