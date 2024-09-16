package websocket

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

const DefaultConnectionErrorLimit = 10

type TTYSize struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
	X    uint16 `json:"x"`
	Y    uint16 `json:"y"`
}

var WebsocketMessageType = map[int]string{
	websocket.BinaryMessage: "binary",
	websocket.TextMessage:   "text",
	websocket.CloseMessage:  "close",
	websocket.PingMessage:   "ping",
	websocket.PongMessage:   "pong",
}

func HandleTerminalWebSocket(w http.ResponseWriter, req *http.Request) {

	connectionErrorLimit := DefaultConnectionErrorLimit
	maxBufferSizeBytes := 512

	connection, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Warn().Msgf("failed to upgrade connection: %s", err)
		return
	}

	terminal := "bash"
	log.Debug().Msgf("starting new tty using command '%s' with arguments ['%s']...", terminal, "")
	cmd := exec.Command(terminal)
	cmd.Env = os.Environ()
	tty, err := pty.Start(cmd)

	if err != nil {
		message := fmt.Sprintf("failed to start tty: %s", err)
		log.Warn().Msg(message)
		connection.WriteMessage(websocket.TextMessage, []byte(message))
		return
	}
	defer func() {
		log.Info().Msg("gracefully stopping spawned tty...")
		if err := cmd.Process.Kill(); err != nil {
			log.Warn().Msgf("failed to kill process: %s", err)
		}
		if _, err := cmd.Process.Wait(); err != nil {
			log.Warn().Msgf("failed to wait for process to exit: %s", err)
		}
		if err := tty.Close(); err != nil {
			log.Warn().Msgf("failed to close spawned tty gracefully: %s", err)
		}
		if err := connection.Close(); err != nil {
			log.Warn().Msgf("failed to close webscoket connection: %s", err)
		}
	}()

	var connectionClosed bool
	var waiter sync.WaitGroup
	waiter.Add(1)

	// this is a keep-alive loop that ensures connection does not hang-up itself
	lastPongTime := time.Now()
	keepalivePingTimeout := 20 * time.Second
	connection.SetPongHandler(func(msg string) error {
		lastPongTime = time.Now()
		return nil
	})
	go func() {
		for {
			if err := connection.WriteMessage(websocket.PingMessage, []byte("keepalive")); err != nil {
				log.Warn().Msg("failed to write ping message")
				return
			}
			time.Sleep(keepalivePingTimeout / 2)
			if time.Now().Sub(lastPongTime) > keepalivePingTimeout {
				log.Warn().Msg("failed to get response from ping, triggering disconnect now...")
				waiter.Done()
				return
			}
			log.Debug().Msg("received response from ping successfully")
		}
	}()

	// tty >> xterm.js
	go func() {
		errorCounter := 0
		for {
			// consider the connection closed/errored out so that the socket handler
			// can be terminated - this frees up memory so the service doesn't get
			// overloaded
			if errorCounter > connectionErrorLimit {
				waiter.Done()
				break
			}
			buffer := make([]byte, maxBufferSizeBytes)
			readLength, err := tty.Read(buffer)
			if err != nil {
				log.Warn().Msgf("failed to read from tty: %s", err)
				if err := connection.WriteMessage(websocket.TextMessage, []byte("bye!")); err != nil {
					log.Warn().Msgf("failed to send termination message from tty to xterm.js: %s", err)
				}
				waiter.Done()
				return
			}
			if err := connection.WriteMessage(websocket.BinaryMessage, buffer[:readLength]); err != nil {
				log.Warn().Msgf("failed to send %v bytes from tty to xterm.js", readLength)
				errorCounter++
				continue
			}
			log.Trace().Msgf("sent message of size %v bytes from tty to xterm.js", readLength)
			errorCounter = 0
		}
	}()

	// tty << xterm.js
	go func() {
		for {
			// data processing
			messageType, data, err := connection.ReadMessage()
			if err != nil {
				if !connectionClosed {
					log.Warn().Msgf("failed to get next reader: %s", err)
				}
				return
			}
			dataLength := len(data)
			dataBuffer := bytes.Trim(data, "\x00")
			dataType, ok := WebsocketMessageType[messageType]
			if !ok {
				dataType = "uunknown"
			}
			log.Info().Msgf("received %s (type: %v) message of size %v byte(s) from xterm.js with key sequence: %v", dataType, messageType, dataLength, dataBuffer)

			// process
			if dataLength == -1 { // invalid
				log.Warn().Msgf("failed to get the correct number of bytes read, ignoring message")
				continue
			}

			// handle resizing
			if messageType == websocket.BinaryMessage {
				if dataBuffer[0] == 1 {
					ttySize := &TTYSize{}
					resizeMessage := bytes.Trim(dataBuffer[1:], " \n\r\t\x00\x01")
					if err := json.Unmarshal(resizeMessage, ttySize); err != nil {
						log.Warn().Msgf("failed to unmarshal received resize message '%s': %s", string(resizeMessage), err)
						continue
					}
					log.Info().Msgf("resizing tty to use %v rows and %v columns...", ttySize.Rows, ttySize.Cols)
					if err := pty.Setsize(tty, &pty.Winsize{
						Rows: ttySize.Rows,
						Cols: ttySize.Cols,
					}); err != nil {
						log.Warn().Msgf("failed to resize tty, error: %s", err)
					}
					continue
				}
			}

			// write to tty
			bytesWritten, err := tty.Write(dataBuffer)
			if err != nil {
				log.Warn().Msg(fmt.Sprintf("failed to write %v bytes to tty: %s", len(dataBuffer), err))
				continue
			}
			log.Trace().Msgf("%v bytes written to tty...", bytesWritten)
		}
	}()

	waiter.Wait()
	log.Info().Msg("closing connection...")
	connectionClosed = true

}
