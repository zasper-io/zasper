package kernel

import (
	"errors"
	"fmt"
	"net/http"

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
