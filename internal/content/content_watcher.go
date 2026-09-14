package content

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
	zhttp "github.com/zasper-io/zasper/internal/http"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: zhttp.SameOrigin,
}

// How long a reload message may take to reach a client before the client is taken to have stalled.
const watchWriteTimeout = 10 * time.Second

/*
projectWatch is one fsnotify watcher over the project, shared by every open watch socket. It starts with
the first subscriber and stops with the last, so the operating system's watches are held once rather than
once per browser tab.
*/
type projectWatch struct {
	mu          sync.Mutex
	root        string
	watcher     *fsnotify.Watcher
	subscribers map[*watchSubscriber]struct{}
}

// watchSubscriber holds at most one pending change: any number of changes before its client is told
// make one reload.
type watchSubscriber struct {
	changed chan struct{}
}

var watch = &projectWatch{subscribers: map[*watchSubscriber]struct{}{}}

// SetUpActiveWatcherConnections stops the watcher and forgets its subscribers, for a server that is
// starting up. The project directory is read here, on the goroutine that has just set it, and not by each
// connection or the walk, which would be reading a global that a restart may be writing.
func SetUpActiveWatcherConnections() {
	watch.mu.Lock()
	defer watch.mu.Unlock()

	if watch.watcher != nil {
		watch.watcher.Close()
		watch.watcher = nil
	}
	watch.root = GetSafePath(".")
	watch.subscribers = map[*watchSubscriber]struct{}{}
}

func (p *projectWatch) subscribe() (*watchSubscriber, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.watcher == nil {
		root := p.root
		if root == "" {
			return nil, errors.New("there is no project directory to watch")
		}
		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			return nil, err
		}
		if err := watcher.Add(root); err != nil {
			watcher.Close()
			return nil, err
		}
		p.watcher = watcher
		go p.run(watcher, root)
	}

	subscriber := &watchSubscriber{changed: make(chan struct{}, 1)}
	p.subscribers[subscriber] = struct{}{}
	return subscriber, nil
}

func (p *projectWatch) unsubscribe(subscriber *watchSubscriber) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if _, ok := p.subscribers[subscriber]; !ok {
		return
	}
	delete(p.subscribers, subscriber)
	if len(p.subscribers) == 0 && p.watcher != nil {
		p.watcher.Close()
		p.watcher = nil
	}
}

// notify tells every subscriber that something changed, without waiting on any of them.
func (p *projectWatch) notify() {
	p.mu.Lock()
	defer p.mu.Unlock()

	for subscriber := range p.subscribers {
		select {
		case subscriber.changed <- struct{}{}:
		default:
		}
	}
}

// run watches the project until the watcher is closed.
func (p *projectWatch) run(watcher *fsnotify.Watcher, root string) {
	watchTree(watcher, root, root)

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			// A folder that has just appeared is watched too, with whatever is already inside it: `git
			// clone` and `mkdir -p` make a whole tree before any one level of it could be reported.
			if event.Has(fsnotify.Create) {
				if info, err := os.Lstat(event.Name); err == nil && info.IsDir() {
					watchTree(watcher, root, event.Name)
				}
			}
			if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) != 0 {
				p.notify()
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Warn().Err(err).Msg("file watcher error")
		}
	}
}

/*
watchTree adds dir and the folders under it, leaving out what ProjectIgnores skips, so a folder called
tests or build is watched like any other. A folder that cannot be read or watched is passed over rather
than ending the walk, so the rest of the project is still watched.
*/
func watchTree(watcher *fsnotify.Watcher, root, dir string) {
	ignores := NewProjectIgnores(root)

	filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			log.Debug().Err(err).Str("path", path).Msg("not watching a folder that cannot be read")
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root && ignores.Skips(path, true) {
			return fs.SkipDir
		}
		if err := watcher.Add(path); err != nil {
			if errors.Is(err, fsnotify.ErrClosed) {
				return fs.SkipAll
			}
			log.Debug().Err(err).Str("path", path).Msg("could not watch a folder; changes in it will not refresh the file browser")
			return fs.SkipDir
		}
		return nil
	})
}

// HandleWatchWebSocket sends a client "reload" whenever something in the project changes.
func HandleWatchWebSocket(w http.ResponseWriter, req *http.Request) {
	connection, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to upgrade connection")
		return
	}
	defer connection.Close()

	subscriber, err := watch.subscribe()
	if err != nil {
		// Closed with a reason: a socket that will never report anything looks like a project where
		// nothing is changing.
		log.Warn().Err(err).Msg("could not watch the project for changes")
		closing := websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "the project cannot be watched")
		connection.WriteControl(websocket.CloseMessage, closing, time.Now().Add(time.Second))
		return
	}
	defer watch.unsubscribe(subscriber)

	stop := make(chan struct{})
	written := make(chan struct{})
	go func() {
		defer close(written)
		for {
			select {
			case <-stop:
				return
			case <-subscriber.changed:
				// A client that has stopped reading is dropped when the deadline passes, rather than
				// holding this goroutine for as long as the server runs.
				connection.SetWriteDeadline(time.Now().Add(watchWriteTimeout))
				if err := connection.WriteMessage(websocket.TextMessage, []byte("reload")); err != nil {
					connection.Close()
					return
				}
			}
		}
	}()

	for {
		if _, _, err := connection.ReadMessage(); err != nil {
			break
		}
	}
	close(stop)
	<-written
}
