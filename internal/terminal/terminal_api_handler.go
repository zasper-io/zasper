package terminal

import (
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/httpx"
)

// ErrNotFound is the answer to an id no live session has, which is a 404 rather than a 500:
// a terminal that has already gone is the usual reason to ask about one.
var ErrNotFound = errors.New("terminal not found")

/*
Model is one running shell, as /api/terminals reports it.

The id and the name are two different things here, unlike everywhere else in this API. A terminal is
named after the tab it is drawn in, and every window numbers its own tabs from one, so two windows
each with a terminal open produce two sessions both called "Terminal 1". The id is what a shutdown
has to name.
*/
type Model struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// The folder the shell is in, relative to the project root; empty for the root itself. Relative
	// because it is shown to somebody who already knows which project they are in.
	Dir     string `json:"dir"`
	Started string `json:"started"`
}

// List reports every shell this server is running, oldest first so that the list does not
// reorder itself between two reads of a map.
func (ts *Terminals) List() []Model {
	sessions := ts.sessions.Snapshot()
	terminals := make([]Model, 0, len(sessions))
	for id, session := range sessions {
		terminals = append(terminals, Model{
			ID:      id,
			Name:    session.Name,
			Dir:     ts.relativeToProject(session.Dir),
			Started: session.Started.Format(time.RFC3339),
		})
	}

	sort.Slice(terminals, func(left, right int) bool {
		if terminals[left].Started != terminals[right].Started {
			return terminals[left].Started < terminals[right].Started
		}
		return terminals[left].ID < terminals[right].ID
	})
	return terminals
}

// Kill stops the shell with this id. The connection it belongs to notices its TTY has gone
// and unregisters the session itself, which is what takes the row out of the list.
func (ts *Terminals) Kill(id string) error {
	session, found := ts.sessions.Get(id)

	if !found {
		return ErrNotFound
	}
	session.stop()
	return nil
}

// StopAll kills every shell, for a server that is shutting down.
func (ts *Terminals) StopAll() {
	for _, session := range ts.sessions.Values() {
		session.stop()
	}
}

// relativeToProject turns the shell's working directory back into a project path. A shell outside the
// project is reported as the OS path it is actually in rather than as a run of `..` segments.
func (ts *Terminals) relativeToProject(dir string) string {
	relative, err := filepath.Rel(ts.project.Root(), dir)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return dir
	}
	if relative == "." {
		return ""
	}
	return relative
}

func (ts *Terminals) ListHandler(w http.ResponseWriter, req *http.Request) {
	httpx.SendJSON(w, http.StatusOK, ts.List())
}

func (ts *Terminals) KillHandler(w http.ResponseWriter, req *http.Request) {
	terminalId := mux.Vars(req)["terminalId"]
	log.Debug().Msgf("shutting down terminal %s", terminalId)

	err := ts.Kill(terminalId)
	if errors.Is(err, ErrNotFound) {
		httpx.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Error killing terminal: %v", err))
		return
	}

	httpx.SendJSON(w, http.StatusOK, map[string]string{
		"message": "Terminal shut down successfully",
	})
}
