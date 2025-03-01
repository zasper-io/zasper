package content

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/core"
)

type ContentWatchConnection struct {
	Conn          *websocket.Conn
	Send          chan []byte
	KernelId      string
	Context       context.Context
	PollingCancel context.CancelFunc
	mu            sync.Mutex
}

var ZasperActiveWatcherConnections map[string]*ContentWatchConnection

func SetUpActiveWatcherConnections() map[string]*ContentWatchConnection {
	return make(map[string]*ContentWatchConnection)
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// Unique session ID generator.
func generateWatchId() string {
	return fmt.Sprintf("%d", time.Now().UnixNano()) // Using Unix time as a unique ID
}

// HandleWatchWebSocket handles WebSocket connections and manages the lifecycle of a terminal session.
func HandleWatchWebSocket(w http.ResponseWriter, req *http.Request) {
	log.Info().Msg("New connection request")
	connection, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to upgrade connection")
		return
	}
	defer connection.Close()

	// Generate a unique session ID for each WebSocket connection
	watchId := generateWatchId()

	log.Info().Msgf("New connection: %s", watchId)

	// Create the context and cancel function for managing the lifecycle
	ctx, cancel := context.WithCancel(context.Background())

	// Create a new ContentWatchConnection
	contentConnection := &ContentWatchConnection{
		Conn:          connection,
		Send:          make(chan []byte),
		KernelId:      watchId,
		Context:       ctx,
		PollingCancel: cancel,
	}

	// Safe add to the global map of active connections
	contentConnection.mu.Lock()
	ZasperActiveWatcherConnections[watchId] = contentConnection
	contentConnection.mu.Unlock()

	// Start watching a directory
	go startWatcher(core.Zasper.HomeDir, contentConnection)

	// Keep the WebSocket open and wait for termination
	for {
		_, _, err := connection.ReadMessage()
		if err != nil {
			log.Warn().Err(err).Msg("Error reading WebSocket message")
			break
		}
	}

	// Clean up when the connection closes
	contentConnection.mu.Lock()
	delete(ZasperActiveWatcherConnections, watchId)
	contentConnection.mu.Unlock()

	log.Info().Msg("Closing connection...")
}

// startWatcher starts a file watcher to monitor a directory and sends signals to the frontend.
func startWatcher(directory string, connection *ContentWatchConnection) {
	// Create a new file watcher
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Error().Msgf("Failed to create file watcher %v", err)
		return
	}
	defer watcher.Close()

	// Add the directory to the watcher
	err = watcher.Add(directory)
	if err != nil {
		log.Fatal().Msgf("Failed to watch directory %v", err)
		return
	}

	log.Info().Msgf("Watching directory: %s", directory)

	// Recursively add the directory and all subdirectories to the watcher
	err = addDirsToWatcher(watcher, directory)
	if err != nil {
		log.Fatal().Msgf("Failed to watch directory %v", err)
		return
	}

	log.Info().Msgf("Watching directory: %s and all its subdirectories", directory)

	// Handle events
	for {
		select {
		case event := <-watcher.Events:
			if event.Op&fsnotify.Write == fsnotify.Write {
				log.Info().Msgf("Modified file: %s", event.Name)
				sendReloadSignal(connection)
			}
			if event.Op&fsnotify.Create == fsnotify.Create {
				log.Info().Msgf("Created file: %s", event.Name)
				sendReloadSignal(connection)
			}
			if event.Op&fsnotify.Remove == fsnotify.Remove {
				log.Info().Msgf("Removed file: %s", event.Name)
				sendReloadSignal(connection)
			}
		case err := <-watcher.Errors:
			log.Error().Err(err).Msg("Error in file watcher")
		}
	}
}

// addDirsToWatcher recursively adds the directory and all subdirectories to the watcher,
// excluding directories like node_modules.
func addDirsToWatcher(watcher *fsnotify.Watcher, directory string) error {
	err := filepath.Walk(directory, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Warn().Err(err).Msgf("Error walking directory: %s", path)
			return err
		}

		if info.IsDir() {
			if shouldExclude(path) {
				log.Info().Msgf("Excluding directory: %s", path)
				return nil
			}

			// Watch the directory
			err := watcher.Add(path)
			if err != nil {
				log.Warn().Err(err).Msgf("Failed to add directory to watcher: %s", path)
				return err
			}
			log.Info().Msgf("Now watching directory: %s", path)
		}
		return nil
	})
	return err
}

// shouldExclude checks if a directory should be excluded from being watched.
func shouldExclude(path string) bool {
	excludedDirs := []string{"node_modules", "build", ".git", ".idea", ".vscode", "dist", "vendor",
		"venv", "tmp", "temp", "cache", "logs", "test", "tests", "coverage"}

	for _, excluded := range excludedDirs {
		if strings.Contains(path, excluded) {
			return true
		}
	}

	return false
}

// sendReloadSignal sends a reload signal to the WebSocket connection.
func sendReloadSignal(connection *ContentWatchConnection) {
	log.Info().Msg("Sending reload signal...")
	connection.mu.Lock()
	defer connection.mu.Unlock()

	// Send a reload message to the frontend
	connection.Conn.WriteMessage(websocket.TextMessage, []byte("reload"))

	// Todo: send close websocket message
}
