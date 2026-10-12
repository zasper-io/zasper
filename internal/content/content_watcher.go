package content

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/httpx"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: httpx.SameOrigin,
}

// How long a message may take to reach a client before the client is taken to have stalled.
const watchWriteTimeout = 10 * time.Second

// More changes than this waiting for one client are sent as a bare "reload": a checkout or an install
// is better answered by reading everything again than by a list of thousands of paths.
const maxPendingPaths = 500

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
	// The folders the walk of the project watches, so that a folder watched only for a file someone has
	// open reports that file and nothing else in it.
	tree map[string]struct{}
	// Who last wrote each path through Zasper and named themselves, and the hash of what they wrote.
	writers map[string]writer
	// Questions asked of the clients, by id, and where their answers go.
	questions map[string]chan unsavedAnswer
}

type writer struct {
	hash   string
	client string
}

/*
watchSubscriber is one client. `changed` holds at most one signal, and pending the paths changed since the
client was last told, so any number of writes to one file before then make one entry.
*/
type watchSubscriber struct {
	changed chan struct{}
	pending map[string]string
	reload  bool
	// The files this client has open, reported wherever they are and sent with their hash.
	wants map[string]struct{}
	// Questions for this client, such as what an open file holds that is not saved.
	asks chan []byte
}

// Change is one path in a message to a client, relative to the project. Hash is set for a file the
// client has open, and is "" when that file is gone. By names who wrote it, when they wrote it through
// Zasper and said who they were, and it still holds what they wrote.
type Change struct {
	Path string  `json:"path"`
	Hash *string `json:"hash,omitempty"`
	By   string  `json:"by,omitempty"`
}

type watchMessage struct {
	Changed []Change `json:"changed"`
}

// watchRequest is what a client sends: every file it has open, replacing what it sent before, or an
// answer to a question it was asked.
type watchRequest struct {
	Watch   []string       `json:"watch"`
	Unsaved *unsavedAnswer `json:"unsaved"`
}

// unsavedAnswer is what an open file holds that is not saved, or None when it holds nothing unsaved.
type unsavedAnswer struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	None bool   `json:"none"`
}

func newProjectWatch(root string) *projectWatch {
	return &projectWatch{
		root:        root,
		subscribers: map[*watchSubscriber]struct{}{},
		tree:        map[string]struct{}{},
		writers:     map[string]writer{},
	}
}

// wrote records that client wrote hash to path, so the change it makes is reported as theirs.
func (p *projectWatch) wrote(path, hash, client string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	clean := filepath.ToSlash(filepath.Clean(path))
	if client == "" {
		delete(p.writers, clean)
		return
	}
	p.writers[clean] = writer{hash: hash, client: client}
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

	subscriber := &watchSubscriber{
		changed: make(chan struct{}, 1),
		pending: map[string]string{},
		wants:   map[string]struct{}{},
		asks:    make(chan []byte, 16),
	}
	p.subscribers[subscriber] = struct{}{}
	return subscriber, nil
}

/*
want records the files a client has open, as paths relative to the project. A file in a folder the walk
leaves out, such as one .gitignore ignores, has its folder watched as well, so it reconciles like any other.
*/
func (p *projectWatch) want(subscriber *watchSubscriber, paths []string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	subscriber.wants = map[string]struct{}{}
	for _, path := range paths {
		clean := filepath.ToSlash(filepath.Clean(path))
		if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, "../") {
			continue
		}
		subscriber.wants[clean] = struct{}{}
		dir := filepath.Dir(filepath.Join(p.root, filepath.FromSlash(clean)))
		if _, watched := p.tree[dir]; watched || p.watcher == nil {
			continue
		}
		if err := p.watcher.Add(dir); err != nil {
			log.Debug().Err(err).Str("path", dir).Msg("could not watch the folder of an open file")
		}
	}
}

// wanted says whether any client has path open.
func (p *projectWatch) wanted(path string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	for subscriber := range p.subscribers {
		if _, ok := subscriber.wants[path]; ok {
			return true
		}
	}
	return false
}

// take hands over what a subscriber has pending, as the message its client is sent.
func (p *projectWatch) take(subscriber *watchSubscriber) []byte {
	p.mu.Lock()
	defer p.mu.Unlock()

	if subscriber.reload {
		subscriber.reload = false
		subscriber.pending = map[string]string{}
		return []byte("reload")
	}
	if len(subscriber.pending) == 0 {
		return nil
	}
	message := watchMessage{Changed: make([]Change, 0, len(subscriber.pending))}
	for path, hash := range subscriber.pending {
		change := Change{Path: path}
		if _, ok := subscriber.wants[path]; ok {
			change.Hash = &hash
			if writer, ok := p.writers[path]; ok && writer.hash == hash {
				change.By = writer.client
			}
		}
		message.Changed = append(message.Changed, change)
	}
	subscriber.pending = map[string]string{}
	data, err := json.Marshal(message)
	if err != nil {
		return []byte("reload")
	}
	return data
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
		p.tree = map[string]struct{}{}
	}
}

// notify tells every subscriber that path changed, without waiting on any of them. hash is what an open
// file now holds.
func (p *projectWatch) notify(path, hash string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for subscriber := range p.subscribers {
		if len(subscriber.pending) >= maxPendingPaths {
			subscriber.reload = true
		} else {
			subscriber.pending[path] = hash
		}
		select {
		case subscriber.changed <- struct{}{}:
		default:
		}
	}
}

// reported says whether a change to path is news to anyone: it is in the watched tree, or someone has it
// open in a folder watched only for that.
func (p *projectWatch) reported(path string) bool {
	p.mu.Lock()
	_, inTree := p.tree[filepath.Dir(path)]
	p.mu.Unlock()
	return inTree || p.wanted(p.relative(path))
}

func (p *projectWatch) relative(path string) string {
	rel, err := filepath.Rel(p.root, path)
	if err != nil {
		return filepath.ToSlash(path)
	}
	return filepath.ToSlash(rel)
}

// run watches the project until the watcher is closed.
func (p *projectWatch) run(watcher *fsnotify.Watcher, root string) {
	p.watchTree(watcher, root, root)

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
					p.watchTree(watcher, root, event.Name)
				}
			}
			// Windows reports a Write on a folder whenever something inside it changes, which would make
			// build/ and node_modules/ reload the browser though they are not watched. A watched folder's
			// changes arrive from its own watch.
			if event.Op == fsnotify.Write {
				if info, err := os.Lstat(event.Name); err == nil && info.IsDir() {
					continue
				}
			}
			if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename) != 0 && p.reported(event.Name) {
				path := p.relative(event.Name)
				hash := ""
				if p.wanted(path) {
					if data, err := os.ReadFile(event.Name); err == nil {
						hash = contentHash(data)
					}
				}
				p.notify(path, hash)
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
func (p *projectWatch) watchTree(watcher *fsnotify.Watcher, root, dir string) {
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
		p.mu.Lock()
		p.tree[path] = struct{}{}
		p.mu.Unlock()
		return nil
	})
}

/*
Watch tells a client what changed in the project: `{"changed": [{"path"}, ...]}`, with a `hash` for each
file the client has said it has open, or the bare string "reload" when it should read everything again.
The client says which files it has open with `{"watch": [paths]}`.
*/
func (h *Handler) Watch(w http.ResponseWriter, req *http.Request) {
	connection, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to upgrade connection")
		return
	}
	defer connection.Close()

	subscriber, err := h.watch.subscribe()
	if err != nil {
		// Closed with a reason: a socket that will never report anything looks like a project where
		// nothing is changing.
		log.Warn().Err(err).Msg("could not watch the project for changes")
		closing := websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "the project cannot be watched")
		connection.WriteControl(websocket.CloseMessage, closing, time.Now().Add(time.Second))
		return
	}
	defer h.watch.unsubscribe(subscriber)

	stop := make(chan struct{})
	written := make(chan struct{})
	go func() {
		defer close(written)
		for {
			select {
			case <-stop:
				return
			case ask := <-subscriber.asks:
				connection.SetWriteDeadline(time.Now().Add(watchWriteTimeout))
				if err := connection.WriteMessage(websocket.TextMessage, ask); err != nil {
					connection.Close()
					return
				}
			case <-subscriber.changed:
				message := h.watch.take(subscriber)
				if message == nil {
					continue
				}
				// A client that has stopped reading is dropped when the deadline passes, rather than
				// holding this goroutine for as long as the server runs.
				connection.SetWriteDeadline(time.Now().Add(watchWriteTimeout))
				if err := connection.WriteMessage(websocket.TextMessage, message); err != nil {
					connection.Close()
					return
				}
			}
		}
	}()

	for {
		_, data, err := connection.ReadMessage()
		if err != nil {
			break
		}
		var request watchRequest
		if json.Unmarshal(data, &request) != nil {
			continue
		}
		if request.Watch != nil {
			h.watch.want(subscriber, request.Watch)
		}
		if request.Unsaved != nil {
			h.watch.answered(*request.Unsaved)
		}
	}
	close(stop)
	<-written
}

// How long the tabs that have a file open are given to say what they hold that is not saved.
const unsavedWait = time.Second

/*
unsaved asks the clients that have path open what it holds that they have not saved, and answers the
first unsaved text one sends, or false when none has any or none answers in time.
*/
func (p *projectWatch) unsaved(path string) (string, bool) {
	clean := filepath.ToSlash(filepath.Clean(path))
	id := uuid.New().String()
	answers := make(chan unsavedAnswer, 16)

	p.mu.Lock()
	if p.questions == nil {
		p.questions = map[string]chan unsavedAnswer{}
	}
	p.questions[id] = answers
	asked := 0
	question, _ := json.Marshal(map[string]any{"read": map[string]string{"id": id, "path": clean}})
	for subscriber := range p.subscribers {
		if _, ok := subscriber.wants[clean]; !ok {
			continue
		}
		select {
		case subscriber.asks <- question:
			asked++
		default:
		}
	}
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		delete(p.questions, id)
		p.mu.Unlock()
	}()

	deadline := time.After(unsavedWait)
	for ; asked > 0; asked-- {
		select {
		case answer := <-answers:
			if !answer.None {
				return answer.Text, true
			}
		case <-deadline:
			return "", false
		}
	}
	return "", false
}

// answered passes a client's answer to the question it answers, if anyone is still waiting on it.
func (p *projectWatch) answered(answer unsavedAnswer) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if answers, ok := p.questions[answer.ID]; ok {
		select {
		case answers <- answer:
		default:
		}
	}
}
