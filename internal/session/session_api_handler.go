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

	zhttp.SendJSON(w, http.StatusOK, sessions)
}

func SessionCreateApiHandler(w http.ResponseWriter, req *http.Request) {
	var body models.SessionModel
	err := json.NewDecoder(req.Body).Decode(&body)
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
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

	zhttp.SendJSON(w, http.StatusCreated, sessions)
}

func SessionDeleteApiHandler(w http.ResponseWriter, req *http.Request) {
	sessionId := mux.Vars(req)["sessionId"]

	if err := DeleteSession(models.SessionModel{Id: sessionId}); err != nil {
		zhttp.SendErrorResponse(w, http.StatusNotFound, err.Error())
		return
	}

	zhttp.SendJSON(w, http.StatusOK, "Session deleted")
}
