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

/*
The open watch connections.

Each connection used to add and remove itself from an exported map under its own `mu`, which is a
per-connection lock and so guards nothing shared: two clients opening a watch socket at the same time
were a concurrent map write, which Go answers by killing the server. `mu` is still the connection's
own, for its socket writes; the store has a lock of its own.

Nothing reads the store yet. It is kept because it is the only record that a connection is open.
*/
var watchers = struct {
	mu sync.Mutex
	by map[string]*ContentWatchConnection
}{by: map[string]*ContentWatchConnection{}}

// SetUpActiveWatcherConnections empties the store, for a server that is starting up.
func SetUpActiveWatcherConnections() {
	watchers.mu.Lock()
	defer watchers.mu.Unlock()

	watchers.by = map[string]*ContentWatchConnection{}
}

func addWatcher(watchId string, connection *ContentWatchConnection) {
	watchers.mu.Lock()
	defer watchers.mu.Unlock()

	watchers.by[watchId] = connection
}

func removeWatcher(watchId string) {
	watchers.mu.Lock()
	defer watchers.mu.Unlock()

	delete(watchers.by, watchId)
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
	log.Debug().Msg("New connection request")
	connection, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to upgrade connection")
		return
	}
	defer connection.Close()

	// Generate a unique session ID for each WebSocket connection
	watchId := generateWatchId()

	log.Debug().Msgf("New connection: %s", watchId)

	// Create the context and cancel function for managing the lifecycle
	ctx, cancel := context.WithCancel(context.Background())
	// The watcher goroutine holds an fsnotify handle per open connection, and the client reconnects
	// whenever the server restarts, so a connection that ends without stopping its watcher leaks one.
	defer cancel()

	// Create a new ContentWatchConnection
	contentConnection := &ContentWatchConnection{
		Conn:          connection,
		Send:          make(chan []byte),
		KernelId:      watchId,
		Context:       ctx,
		PollingCancel: cancel,
	}

	addWatcher(watchId, contentConnection)

	// Start watching a directory
	go startWatcher(core.Zasper.HomeDir, contentConnection)

	// Keep the WebSocket open and wait for termination
	for {
		_, _, err := connection.ReadMessage()
		if err != nil {
			// A client that navigates away or reloads closes the socket, which is how this loop
			// normally ends rather than a fault worth warning about.
			if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Warn().Err(err).Msg("Error reading WebSocket message")
			}
			break
		}
	}

	// Clean up when the connection closes
	removeWatcher(watchId)

	log.Debug().Msg("Closing connection...")
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
		log.Error().Err(err).Msgf("Failed to watch directory: %s", directory)
		return
	}

	// Recursively add the directory and all subdirectories to the watcher. A directory that cannot be
	// walked is worth saying so about, but the ones that were added still report what they see.
	if err := addDirsToWatcher(watcher, directory); err != nil {
		log.Error().Err(err).Msgf("Failed to watch every subdirectory of: %s", directory)
	}

	log.Info().Msgf("Watching directory: %s and all its subdirectories", directory)

	// Handle events
	for {
		select {
		case <-connection.Context.Done():
			return
		case event := <-watcher.Events:
			if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove) != 0 {
				log.Debug().Msgf("%s: %s", event.Op, event.Name)
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
			if shouldExclude(directory, path) {
				log.Debug().Msgf("Excluding directory: %s", path)
				// Nothing inside an excluded directory is watched either, and node_modules is the
				// reason: walking it is the expensive part.
				return filepath.SkipDir
			}

			// Watch the directory
			err := watcher.Add(path)
			if err != nil {
				log.Warn().Err(err).Msgf("Failed to add directory to watcher: %s", path)
				return err
			}
			log.Debug().Msgf("Now watching directory: %s", path)
		}
		return nil
	})
	return err
}

var excludedDirs = map[string]bool{
	"node_modules": true, "build": true, ".git": true, ".idea": true, ".vscode": true,
	"dist": true, "vendor": true, "venv": true, "tmp": true, "temp": true, "cache": true,
	"logs": true, "test": true, "tests": true, "coverage": true,
}

// shouldExclude checks if a directory should be excluded from being watched. Segment by segment
// against the path below the project root: matching the absolute path as a substring threw away
// every project that happened to live under /tmp, and every folder whose name merely contained one
// of these.
func shouldExclude(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}

	for _, segment := range strings.Split(relative, string(filepath.Separator)) {
		if excludedDirs[segment] {
			return true
		}
	}

	return false
}

// sendReloadSignal sends a reload signal to the WebSocket connection.
func sendReloadSignal(connection *ContentWatchConnection) {
	log.Debug().Msg("Sending reload signal...")
	connection.mu.Lock()
	defer connection.mu.Unlock()

	// Send a reload message to the frontend
	connection.Conn.WriteMessage(websocket.TextMessage, []byte("reload"))

	// Todo: send close websocket message
}
