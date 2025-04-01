package core

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog/log"
)

type ConfigModifierPayload struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func ConfigModifyHandler(w http.ResponseWriter, req *http.Request) {
	var body ConfigModifierPayload
	err := json.NewDecoder(req.Body).Decode(&body)
	log.Info().Msgf("Content requested with payload: %+v", body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	key := body.Key
	value := body.Value

	if key == "theme" {
		changeTheme(value)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
}
