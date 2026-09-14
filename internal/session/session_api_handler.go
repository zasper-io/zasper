package session

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gorilla/mux"

	"github.com/zasper-io/zasper/internal/httpx"
	"github.com/zasper-io/zasper/internal/kernelspec"
	"github.com/zasper-io/zasper/internal/models"
)

// ListHandler answers every running session.
func (s *Sessions) ListHandler(w http.ResponseWriter, req *http.Request) {
	httpx.SendJSON(w, http.StatusOK, s.List())
}

// CreateHandler starts a session, or joins the one already running the notebook.
func (s *Sessions) CreateHandler(w http.ResponseWriter, req *http.Request) {
	var body models.SessionModel
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	session, err := s.Create(body)
	if errors.Is(err, kernelspec.ErrKernelspecNotFound) {
		httpx.SendErrorResponse(w, http.StatusNotFound, "Failed to create session: "+err.Error())
		return
	}
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, "Failed to create session: "+err.Error())
		return
	}

	httpx.SendJSON(w, http.StatusCreated, session)
}

// DeleteHandler ends a session and stops its kernel.
func (s *Sessions) DeleteHandler(w http.ResponseWriter, req *http.Request) {
	if err := s.Delete(mux.Vars(req)["sessionId"]); err != nil {
		httpx.SendErrorResponse(w, http.StatusNotFound, err.Error())
		return
	}

	httpx.SendJSON(w, http.StatusOK, "Session deleted")
}
