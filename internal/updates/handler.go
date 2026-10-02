package updates

import (
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/httpx"
)

// StatusResponse is GET /api/updates.
type StatusResponse struct {
	Status
	// WhatsNew is true until the running version's notes have been shown once.
	WhatsNew bool `json:"whats_new"`
}

// StatusHandler answers the last check, without asking zasper.io.
func (c *Checker) StatusHandler(w http.ResponseWriter, r *http.Request) {
	httpx.SendJSON(w, http.StatusOK, StatusResponse{Status: c.Status(), WhatsNew: c.WhatsNewPending()})
}

// CheckHandler asks zasper.io now. A failed check is reported in the status rather than as an error,
// as it is everywhere else.
func (c *Checker) CheckHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := c.Check(r.Context()); err != nil {
		log.Debug().Err(err).Msg("could not check for updates")
	}
	httpx.SendJSON(w, http.StatusOK, StatusResponse{Status: c.Status(), WhatsNew: c.WhatsNewPending()})
}

// WhatsNewHandler answers the notes the What's new tab shows.
func (c *Checker) WhatsNewHandler(w http.ResponseWriter, r *http.Request) {
	httpx.SendJSON(w, http.StatusOK, c.WhatsNew())
}

// SeenHandler records the running version's notes as shown.
func (c *Checker) SeenHandler(w http.ResponseWriter, r *http.Request) {
	if err := c.MarkWhatsNewSeen(); err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, "could not record the notes as shown")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
