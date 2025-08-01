package session

import (
	"encoding/json"
	"net/http"

	zhttp "github.com/zasper-io/zasper/internal/http"
	"github.com/zasper-io/zasper/internal/models"
)

func SessionApiHandler(w http.ResponseWriter, req *http.Request) {
	sessions := ListSessions()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(sessions)
}

func SessionCreateApiHandler(w http.ResponseWriter, req *http.Request) {
	var body models.SessionModel
	err := json.NewDecoder(req.Body).Decode(&body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	sessions, err := CreateSession(body)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, "Failed to create session: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(sessions)
}

func SessionDeleteApiHandler(w http.ResponseWriter, req *http.Request) {
	var body models.SessionModel
	err := json.NewDecoder(req.Body).Decode(&body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	DeleteSession(body)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode("Session deleted")
}
