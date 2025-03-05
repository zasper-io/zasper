package session

import (
	"encoding/json"
	"net/http"

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

	sessions := CreateSession(body)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
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
