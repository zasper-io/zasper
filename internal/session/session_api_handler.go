package session

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gorilla/mux"
	zhttp "github.com/zasper-io/zasper/internal/http"
	"github.com/zasper-io/zasper/internal/kernelspec"
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
	if errors.Is(err, kernelspec.ErrKernelspecNotFound) {
		zhttp.SendErrorResponse(w, http.StatusNotFound, "Failed to create session: "+err.Error())
		return
	}
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, "Failed to create session: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(sessions)
}

func SessionDeleteApiHandler(w http.ResponseWriter, req *http.Request) {
	sessionId := mux.Vars(req)["sessionId"]

	if err := DeleteSession(models.SessionModel{Id: sessionId}); err != nil {
		zhttp.SendErrorResponse(w, http.StatusNotFound, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode("Session deleted")
}
