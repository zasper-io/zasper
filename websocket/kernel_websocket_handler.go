package websocket

import (
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/zasper-io/zasper/core"
	"github.com/zasper-io/zasper/kernel"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/pebbe/zmq4"
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
	log.Println("receieved kernel connection request")
	vars := mux.Vars(req)
	kernelId := vars["kernelId"]
	log.Println("kernelName :", kernelId)

	sessionId := req.URL.Query().Get("session_id")
	log.Println("sessionId :", sessionId)

	session, ok := core.ZasperSession[sessionId]
	log.Println("session", session)
	if !ok {
		log.Println("session not found")
		http.NotFound(w, req)
		return
	}

	kernelManager, ok := kernel.ZasperActiveKernels[kernelId]

	if !ok {
		log.Println("kernel not found")
		http.NotFound(w, req)
		return
	}

	conn, err := upgrader.Upgrade(w, req, nil)

	if err != nil {
		log.Println(err)
		return
	}

	// defer conn.Close()

	// handle websocket messages

	kernelConnection := KernelWebSocketConnection{
		KernelId:      kernelId,
		KernelManager: kernelManager,
		Channels:      make(map[string]*zmq4.Socket),
		Conn:          conn,
	}

	log.Println("preparing kernel connection")
	kernelConnection.prepare(sessionId)

	log.Println("connecting kernel")
	kernelConnection.connect()

	clientsMu.Lock()
	clients[&kernelConnection] = true
	clientsMu.Unlock()

	// go handleMessages(&kernelConnection)
	// defer func() {
	// 	clientsMu.Lock()
	// 	delete(clients, &kernelConnection)
	// 	clientsMu.Unlock()
	// 	conn.Close()
	// }()

	go kernelConnection.readMessages()
	// go kernelConnection.writeMessages()
}

func (kwsConn *KernelWebSocketConnection) readMessages() {
	defer func() {
		kwsConn.Conn.Close()
		delete(clients, kwsConn)
	}()

	for {
		messageType, data, err := kwsConn.Conn.ReadMessage()
		if err != nil {
			log.Println(err)
			return
		}
		fmt.Printf("Received message: %s\n", data)

		log.Println("message type =>", messageType)
		log.Println("data receieved =>", data)
		kwsConn.handleIncomingMessage(messageType, data)

		// echo the message to the client
		if err := kwsConn.Conn.WriteMessage(messageType, data); err != nil {
			log.Println(err)
			return
		}
		// broadcast <- message // Send message to broadcast channel
	}
}

func (c *KernelWebSocketConnection) writeMessages() {
	defer c.Conn.Close()
	for {
		message, ok := <-c.send
		if !ok {
			c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
			return
		}
		if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			log.Println("Error writing message:", err)
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
			case client.send <- message:
			default:
				close(client.send)
				delete(clients, client)
			}
		}
	}
}
