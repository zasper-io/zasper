package analytics

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/core"
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
		http.Error(w, "malformed telemetry payload", http.StatusBadRequest)
		return
	}

	if len(payload.Events) > maxEventsPerReq {
		http.Error(w, "too many events", http.StatusRequestEntityTooLarge)
		return
	}

	for _, event := range payload.Events {
		// Track validates again. Doing it here too is what lets a bad event answer 400 rather than
		// disappearing into a log line the caller never sees.
		if err := Validate(event.Event, event.Properties); err != nil {
			log.Warn().Msgf("Rejecting telemetry event from the frontend: %v", err)
			http.Error(w, "event rejected", http.StatusBadRequest)
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// TelemetrySettingsModifyHandler applies a change from the settings panel: turning tracking off, or
// throwing the anonymous id away and starting a new one.
func TelemetrySettingsModifyHandler(w http.ResponseWriter, req *http.Request) {
	var payload telemetrySettingsPayload
	if err := json.NewDecoder(io.LimitReader(req.Body, maxBodyBytes)).Decode(&payload); err != nil {
		http.Error(w, "malformed payload", http.StatusBadRequest)
		return
	}

	if payload.Enabled != nil {
		if err := core.SetTelemetryEnabled(*payload.Enabled); err != nil {
			http.Error(w, "could not save the setting", http.StatusInternalServerError)
			return
		}
		SetEnabled(*payload.Enabled)
	}

	if payload.ResetID {
		if err := ResetTrackingId(); err != nil {
			http.Error(w, "could not reset the id", http.StatusInternalServerError)
			return
		}
	}

	TelemetrySettingsHandler(w, req)
}
