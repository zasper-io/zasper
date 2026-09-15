package config

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/zasper-io/zasper/internal/httpx"
)

type ConfigModifierPayload struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// ConfigModifyHandler changes one setting: the theme, whether widget code may be loaded from the CDN, or
// the editor settings. Telemetry has an endpoint of its own, because turning it off also has to stop the client that
// is sending.
func ConfigModifyHandler(w http.ResponseWriter, req *http.Request) {
	var body ConfigModifierPayload
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}
	log.Debug().Msgf("config change requested: %+v", body)

	switch body.Key {
	case "theme":
		if body.Value == "" {
			httpx.SendErrorResponse(w, http.StatusBadRequest, "a theme needs a name")
			return
		}
		if err := changeTheme(body.Value); err != nil {
			log.Warn().Err(err).Msg("could not save the theme")
			httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("could not save the theme: %v", err))
			return
		}
	case "widget_cdn":
		if body.Value != "on" && body.Value != "off" {
			httpx.SendErrorResponse(w, http.StatusBadRequest, `widget_cdn is "on" or "off"`)
			return
		}
		if err := setWidgetCDN(body.Value == "on"); err != nil {
			log.Warn().Err(err).Msg("could not save the widget setting")
			httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("could not save the widget setting: %v", err))
			return
		}
	case "editor":
		// The whole set, as JSON: the settings are written together, and a default for one alone means nothing.
		var settings EditorSettings
		if err := json.Unmarshal([]byte(body.Value), &settings); err != nil {
			httpx.SendErrorResponse(w, http.StatusBadRequest, "editor settings are a JSON object")
			return
		}
		if err := setEditorSettings(settings); err != nil {
			log.Warn().Err(err).Msg("could not save the editor settings")
			httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("could not save the editor settings: %v", err))
			return
		}
	case "language_servers":
		var settings LanguageServerSettings
		if err := json.Unmarshal([]byte(body.Value), &settings); err != nil {
			httpx.SendErrorResponse(w, http.StatusBadRequest, "language server settings are a JSON object")
			return
		}
		if err := setLanguageServerSettings(settings); err != nil {
			log.Warn().Err(err).Msg("could not save the language server settings")
			httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("could not save the language server settings: %v", err))
			return
		}
	default:
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("there is no setting called %q", body.Key))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
