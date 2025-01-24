package kernel

import (
	"encoding/json"
	"fmt"

	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/gorilla/mux"
)

// Response structure for consistent API responses
type APIResponse struct {
	Message string `json:"message"`
}

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

// DELETE handler for /api/kernels/{kernel_id}
func KernelDeleteAPIHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	kernelID := vars["kernel_id"]

	// Try to delete the kernel from "database"
	err := killKernelById(kernelID)
	if err != nil {
		// If the kernel is not found, respond with 404
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(APIResponse{Message: err.Error()})
		return
	}

	// If deletion is successful, respond with 200 OK
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(APIResponse{Message: fmt.Sprintf("Kernel with ID %s deleted successfully.", kernelID)})
}
