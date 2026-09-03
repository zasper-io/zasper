package kernel

import (
	"encoding/json"
	"errors"
	"fmt"

	"net/http"

	"github.com/rs/zerolog/log"
	zhttp "github.com/zasper-io/zasper/internal/http"

	"github.com/gorilla/mux"
)

func KernelListAPIHandler(w http.ResponseWriter, req *http.Request) {
	kernels, err := listKernels()
	if err != nil {
		log.Error().Msgf("Error listing kernels: %v", err)
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error listing kernels: %v", err))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(kernels)
}

func KernelReadAPIHandler(w http.ResponseWriter, req *http.Request) {
	vars := mux.Vars(req)
	kernelId := vars["kernelId"]
	log.Debug().Msgf("kernelId : %s", kernelId)

	kernel, err := getKernel(kernelId)
	if errors.Is(err, ErrKernelNotFound) {
		zhttp.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Error getting kernel: %v", err))
		return
	}
	if err != nil {
		log.Error().Msgf("Error getting kernel: %v", err)
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error getting kernel: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(kernel)
}

func KernelInterruptAPIHandler(w http.ResponseWriter, req *http.Request) {
	vars := mux.Vars(req)
	kernelId := vars["kernelId"]
	log.Info().Msgf("kernelId : %s", kernelId)

	err := interruptKernel(kernelId)
	if errors.Is(err, ErrKernelNotFound) {
		zhttp.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Error interrupting kernel: %v", err))
		return
	}
	if err != nil {
		log.Error().Msgf("Error interrupting kernel: %v", err)
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error interrupting kernel: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Kernel interrupted successfully",
	})
}

func KernelKillAPIHandler(w http.ResponseWriter, req *http.Request) {
	vars := mux.Vars(req)
	kernelId := vars["kernelId"]
	log.Info().Msgf("kernelId : %s", kernelId)

	err := KillKernelById(kernelId)
	if errors.Is(err, ErrKernelNotFound) {
		log.Error().Msgf("Error killing kernel: %v", err)
		zhttp.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Error killing kernel: %v", err))
		return
	}
	if err != nil {
		log.Error().Msgf("Error killing kernel: %v", err)
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error killing kernel: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Kernel killed successfully",
	})
}
