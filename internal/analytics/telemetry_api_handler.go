package analytics

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/core"
	zhttp "github.com/zasper-io/zasper/internal/http"
)

// Enough for a flush of a browsing session's worth of events, and small enough that the endpoint
// cannot be used to push anything substantial through the process.
const (
	maxBodyBytes    = 8 << 10
	maxEventsPerReq = 20
)

type telemetryEvent struct {
	Event      EventType              `json:"event"`
	Properties map[string]interface{} `json:"properties"`
}

type telemetryPayload struct {
	Events []telemetryEvent `json:"events"`
}

type telemetrySettings struct {
	Enabled bool `json:"enabled"`
	// False until the user has been asked, which is what makes the first-run notice appear once.
	Chosen bool `json:"chosen"`
}

type telemetrySettingsPayload struct {
	Enabled *bool `json:"enabled"`
	ResetID bool  `json:"reset_id"`
}

// TelemetryHandler takes events the server cannot observe for itself — which tab was opened, which
// command was run — and puts them through the same catalogue as everything else. The frontend is not
// trusted here: it names an event and some properties, and events.go decides whether that is a thing
// Zasper sends.
func TelemetryHandler(w http.ResponseWriter, req *http.Request) {
	if !Enabled() {
		// Not an error: the frontend is allowed to keep reporting into the void rather than having to
		// track whether the user turned tracking off mid-session.
		w.WriteHeader(http.StatusNoContent)
		return
	}

	var payload telemetryPayload
	if err := json.NewDecoder(io.LimitReader(req.Body, maxBodyBytes)).Decode(&payload); err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "malformed telemetry payload")
		return
	}

	if len(payload.Events) > maxEventsPerReq {
		zhttp.SendErrorResponse(w, http.StatusRequestEntityTooLarge, "too many events")
		return
	}

	for _, event := range payload.Events {
		// Track validates again. Doing it here too is what lets a bad event answer 400 rather than
		// disappearing into a log line the caller never sees.
		if err := Validate(event.Event, event.Properties); err != nil {
			log.Warn().Msgf("Rejecting telemetry event from the frontend: %v", err)
			zhttp.SendErrorResponse(w, http.StatusBadRequest, "event rejected")
			return
		}
		Track(event.Event, event.Properties)
	}

	w.WriteHeader(http.StatusNoContent)
}

// TelemetrySettingsHandler reports whether tracking is on and whether the user has ever been asked.
func TelemetrySettingsHandler(w http.ResponseWriter, req *http.Request) {
	stored, chosen := core.TelemetryPreference()

	// Enabled() rather than the stored value: --tracking=false and ZASPER_TELEMETRY=0 both outrank
	// the config file, and the toggle has to show what is actually happening.
	response := telemetrySettings{Enabled: Enabled(), Chosen: chosen || !stored}

	zhttp.SendJSON(w, http.StatusOK, response)
}

// TelemetrySettingsModifyHandler applies a change from the settings panel: turning tracking off, or
// throwing the anonymous id away and starting a new one.
func TelemetrySettingsModifyHandler(w http.ResponseWriter, req *http.Request) {
	var payload telemetrySettingsPayload
	if err := json.NewDecoder(io.LimitReader(req.Body, maxBodyBytes)).Decode(&payload); err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "malformed payload")
		return
	}

	if payload.Enabled != nil {
		if err := core.SetTelemetryEnabled(*payload.Enabled); err != nil {
			zhttp.SendErrorResponse(w, http.StatusInternalServerError, "could not save the setting")
			return
		}
		SetEnabled(*payload.Enabled)
	}

	if payload.ResetID {
		if err := ResetTrackingId(); err != nil {
			zhttp.SendErrorResponse(w, http.StatusInternalServerError, "could not reset the id")
			return
		}
	}

	TelemetrySettingsHandler(w, req)
}
