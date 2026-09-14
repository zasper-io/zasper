package core

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"
	zhttp "github.com/zasper-io/zasper/internal/http"
)

type ConfigModifierPayload struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// ConfigModifyHandler changes one setting. The theme is the only one: telemetry has an endpoint of its
// own, because turning it off also has to stop the client that is sending.
func ConfigModifyHandler(w http.ResponseWriter, req *http.Request) {
	var body ConfigModifierPayload
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}
	log.Debug().Msgf("config change requested: %+v", body)

	switch body.Key {
	case "theme":
		if body.Value == "" {
			zhttp.SendErrorResponse(w, http.StatusBadRequest, "a theme needs a name")
			return
		}
		if err := changeTheme(body.Value); err != nil {
			log.Warn().Err(err).Msg("could not save the theme")
			zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("could not save the theme: %v", err))
			return
		}
	default:
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("there is no setting called %q", body.Key))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
