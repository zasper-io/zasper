package websocket

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/core"
	zhttp "github.com/zasper-io/zasper/internal/http"
)

// ErrTerminalNotFound is the answer to an id no live session has, which is a 404 rather than a 500:
// a terminal that has already gone is the usual reason to ask about one.
var ErrTerminalNotFound = errors.New("terminal not found")

/*
TerminalModel is one running shell, as /api/terminals reports it.

The id and the name are two different things here, unlike everywhere else in this API. A terminal is
named after the tab it is drawn in, and every window numbers its own tabs from one, so two windows
each with a terminal open produce two sessions both called "Terminal 1". The id is what a shutdown
has to name.
*/
type TerminalModel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// The folder the shell is in, relative to the project root; empty for the root itself. Relative
	// because it is shown to somebody who already knows which project they are in.
	Dir     string `json:"dir"`
	Started string `json:"started"`
}

// ListTerminals reports every shell this server is running, oldest first so that the list does not
// reorder itself between two reads of a map.
func ListTerminals() []TerminalModel {
	terminalSessionsMu.Lock()
	defer terminalSessionsMu.Unlock()

	terminals := make([]TerminalModel, 0, len(terminalSessions))
	for id, session := range terminalSessions {
		terminals = append(terminals, TerminalModel{
			ID:      id,
			Name:    session.Name,
			Dir:     relativeToProject(session.Dir),
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

// KillTerminal stops the shell with this id. The connection it belongs to notices its TTY has gone
// and unregisters the session itself, which is what takes the row out of the list.
func KillTerminal(id string) error {
	terminalSessionsMu.Lock()
	session, found := terminalSessions[id]
	terminalSessionsMu.Unlock()

	if !found {
		return ErrTerminalNotFound
	}
	session.stop()
	return nil
}

// relativeToProject turns the shell's working directory back into a project path. A shell outside the
// project is reported as the OS path it is actually in rather than as a run of `..` segments.
func relativeToProject(dir string) string {
	relative, err := filepath.Rel(core.Zasper.HomeDir, dir)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return dir
	}
	if relative == "." {
		return ""
	}
	return relative
}

func TerminalListAPIHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(ListTerminals())
}

func TerminalKillAPIHandler(w http.ResponseWriter, req *http.Request) {
	terminalId := mux.Vars(req)["terminalId"]
	log.Info().Msgf("terminalId : %s", terminalId)

	err := KillTerminal(terminalId)
	if errors.Is(err, ErrTerminalNotFound) {
		zhttp.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Error killing terminal: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Terminal shut down successfully",
	})
}
