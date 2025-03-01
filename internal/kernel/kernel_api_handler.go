package kernel

import (
	"encoding/json"
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

	log.Info().Msg("Get request received")

	vars := mux.Vars(req)
	kernelId := vars["kernelId"]
	log.Info().Msgf("kernelId : %s", kernelId)

	kernel, err := getKernel(kernelId)
	if err != nil {
		log.Error().Msgf("Error getting kernel: %v", err)
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error getting kernel: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(kernel)
}
