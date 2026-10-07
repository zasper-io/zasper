package trust

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/zasper-io/zasper/internal/httpx"
)

type pathBody struct {
	Path string `json:"path"`
}

type allBody struct {
	TrustAll bool `json:"trust_all"`
}

// StateHandler answers whether the project is trusted, and the folders that are.
func (g *Gate) StateHandler(w http.ResponseWriter, req *http.Request) {
	httpx.SendJSON(w, http.StatusOK, g.State())
}

// TrustHandler trusts the project, or a folder it is in, and answers the state that follows.
func (g *Gate) TrustHandler(w http.ResponseWriter, req *http.Request) {
	var body pathBody
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.Path == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "a folder to trust is a path")
		return
	}
	if err := g.Trust(body.Path, time.Now()); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, g.State())
}

// ForgetHandler stops trusting a folder.
func (g *Gate) ForgetHandler(w http.ResponseWriter, req *http.Request) {
	var body pathBody
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.Path == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "a folder to forget is a path")
		return
	}
	if err := g.Forget(body.Path); err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, g.State())
}

// TrustAllHandler sets trust_all.
func (g *Gate) TrustAllHandler(w http.ResponseWriter, req *http.Request) {
	var body allBody
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "trust_all is true or false")
		return
	}
	if err := g.SetTrustAll(body.TrustAll); err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, g.State())
}

// Require refuses next with 403 while the project is not trusted.
func (g *Gate) Require(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if Refused(w, g.Check()) {
			return
		}
		next(w, req)
	}
}

// Refused answers 403 with the error the UI turns into the trust question, and reports whether it did.
func Refused(w http.ResponseWriter, err error) bool {
	if !errors.Is(err, ErrUntrusted) {
		return false
	}
	httpx.SendJSON(w, http.StatusForbidden, map[string]string{"error": "untrusted", "message": ErrUntrusted.Error()})
	return true
}
