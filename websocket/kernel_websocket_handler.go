package websocket

import (
	"fmt"
	"log"
	"net/http"

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

	defer conn.Close()

	// handle websocket messages

	kernelConnection := KernelWebSocketConnection{
		KernelManager: kernelManager,
		Channels:      make(map[string]*zmq4.Socket),
	}

	log.Println("preparing kernel connection")
	kernelConnection.prepare(sessionId)

	log.Println("connecting kernel")
	kernelConnection.connect()
	// log.Println("session is => ", session)
	for {
		messageType, data, err := conn.ReadMessage()
		// Note: messageType is either TextMessage or BinaryMessage.
		if err != nil {
			log.Println(err)
			return
		}
		fmt.Printf("Received message: %s\n", data)

		log.Println("message type =>", messageType)
		log.Println("data receieved =>", data)
		kernelConnection.handleIncomingMessage(messageType, data)

		// echo the message to the client
		if err := conn.WriteMessage(messageType, data); err != nil {
			log.Println(err)
			return
		}
	}

}
