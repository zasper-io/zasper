package kernel

import (
	"encoding/json"

	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/gorilla/mux"
)

func KernelListAPIHandler(w http.ResponseWriter, req *http.Request) {
	kernels := listKernels()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(kernels)
}

func KernelReadAPIHandler(w http.ResponseWriter, req *http.Request) {

	log.Info().Msg("Get request received")

	vars := mux.Vars(req)
	kernelId := vars["kernelId"]
	log.Info().Msgf("kernelId : %s", kernelId)

	kernel := getKernel(kernelId)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(kernel)
}
