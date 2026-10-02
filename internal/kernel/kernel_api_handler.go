package kernel

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/gorilla/mux"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/httpx"
)

// ListHandler answers every running kernel.
func (k *Kernels) ListHandler(w http.ResponseWriter, req *http.Request) {
	httpx.SendJSON(w, http.StatusOK, k.list())
}

// GetHandler answers one running kernel.
func (k *Kernels) GetHandler(w http.ResponseWriter, req *http.Request) {
	kernel, err := k.model(mux.Vars(req)["kernelId"])
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Error getting kernel: %v", err))
		return
	}
	httpx.SendJSON(w, http.StatusOK, kernel)
}

// InterruptHandler interrupts a running kernel.
func (k *Kernels) InterruptHandler(w http.ResponseWriter, req *http.Request) {
	kernelId := mux.Vars(req)["kernelId"]
	log.Debug().Msgf("interrupting kernel %s", kernelId)

	err := k.interrupt(kernelId)
	if errors.Is(err, ErrKernelNotFound) {
		httpx.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Error interrupting kernel: %v", err))
		return
	}
	if err != nil {
		log.Error().Msgf("Error interrupting kernel: %v", err)
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error interrupting kernel: %v", err))
		return
	}

	language := "other"
	if km, ok := k.Get(kernelId); ok {
		language = analytics.NormalizeLanguage(km.KernelName)
	}
	analytics.Track(analytics.EventKernelInterrupted, map[string]interface{}{
		"kernel_language": language,
	})

	httpx.SendJSON(w, http.StatusOK, map[string]string{
		"message": "Kernel interrupted successfully",
	})
}

// KillHandler stops a running kernel.
func (k *Kernels) KillHandler(w http.ResponseWriter, req *http.Request) {
	kernelId := mux.Vars(req)["kernelId"]
	log.Debug().Msgf("stopping kernel %s", kernelId)

	if err := k.Stop(kernelId); err != nil {
		httpx.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Error killing kernel: %v", err))
		return
	}

	httpx.SendJSON(w, http.StatusOK, map[string]string{
		"message": "Kernel killed successfully",
	})
}

const (
	// How long a variables request waits for the kernel. A request sent while a cell runs is answered when
	// the cell finishes, so this is also how long the panel says it is waiting before giving up.
	inspectTimeout = 10 * time.Second
	previewRows    = 100
	maxPreviewRows = 1000
)

var identifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// VariablesHandler lists the names in a kernel's namespace.
func (k *Kernels) VariablesHandler(w http.ResponseWriter, req *http.Request) {
	km, ok := k.Get(mux.Vars(req)["kernelId"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "kernel not found")
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), inspectTimeout)
	defer cancel()

	variables, err := km.Variables(ctx)
	if err != nil {
		sendInspectError(w, err)
		return
	}
	httpx.SendJSON(w, http.StatusOK, variables)
}

// PreviewHandler answers a page of rows from a table-like variable.
func (k *Kernels) PreviewHandler(w http.ResponseWriter, req *http.Request) {
	vars := mux.Vars(req)
	km, ok := k.Get(vars["kernelId"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "kernel not found")
		return
	}
	name := vars["name"]
	if !identifier.MatchString(name) {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "not a variable name")
		return
	}
	offset, err := queryInt(req, "offset", 0)
	if err != nil || offset < 0 {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "offset must be a whole number")
		return
	}
	limit, err := queryInt(req, "limit", previewRows)
	if err != nil || limit < 1 || limit > maxPreviewRows {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("limit must be between 1 and %d", maxPreviewRows))
		return
	}

	ctx, cancel := context.WithTimeout(req.Context(), inspectTimeout)
	defer cancel()

	preview, err := km.Preview(ctx, name, offset, limit)
	if err != nil {
		sendInspectError(w, err)
		return
	}
	if preview.Error != "" {
		httpx.SendErrorResponse(w, http.StatusUnprocessableEntity, preview.Error)
		return
	}
	httpx.SendJSON(w, http.StatusOK, preview)
}

func queryInt(req *http.Request, key string, fallback int) (int, error) {
	value := req.URL.Query().Get(key)
	if value == "" {
		return fallback, nil
	}
	return strconv.Atoi(value)
}

func sendInspectError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotInspectable):
		httpx.SendErrorResponse(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, context.DeadlineExceeded):
		httpx.SendErrorResponse(w, http.StatusGatewayTimeout, "the kernel is busy; try again once the running cell finishes")
	default:
		httpx.SendErrorResponse(w, http.StatusInternalServerError, err.Error())
	}
}
