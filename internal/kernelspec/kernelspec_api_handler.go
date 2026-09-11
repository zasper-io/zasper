package kernelspec

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gorilla/mux"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/core"
	zhttp "github.com/zasper-io/zasper/internal/http"
)

// Handler to serve kernel resources (like logos)
func ServeKernelResource(w http.ResponseWriter, req *http.Request) {

	vars := mux.Vars(req)
	kernelName := vars["kernel"]
	resourcePath := vars["resource"]

	fullPath, ok := getResourceFile(kernelName, resourcePath)
	if !ok {
		zhttp.SendErrorResponse(w, http.StatusNotFound, "File not found")
		return
	}

	resourceData, err := os.ReadFile(fullPath)
	if err != nil {
		log.Error().Msgf("Error reading file: %v", err)
		zhttp.SendErrorResponse(w, http.StatusNotFound, "File not found")
		return
	}

	// TrimPrefix rather than [1:]: a resource with no dot in it has no extension, and slicing "" at
	// 1 panics — after the read above has already succeeded, so the request died at the last step.
	ext := strings.TrimPrefix(filepath.Ext(resourcePath), ".")

	var contentType string

	switch ext {
	case "png":
		contentType = "image/png"
	case "svg":
		contentType = "image/svg+xml"
	default:
		contentType = "application/octet-stream" // default for unknown file types
	}

	w.Header().Set("Content-Type", contentType)
	w.Write(resourceData)
}

// SingleKernelspecAPIHandler answers Jupyter Server's model for one kernelspec, named as the URL has it.
func SingleKernelspecAPIHandler(w http.ResponseWriter, req *http.Request) {

	vars := mux.Vars(req)
	kernelName := vars["kernelName"]

	kspec, err := GetKernelSpec(kernelName)
	if errors.Is(err, ErrKernelspecNotFound) {
		zhttp.SendErrorResponse(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(kernelspecModel(kernelName, kspec))
}

func KernelspecAPIHandler(w http.ResponseWriter, req *http.Request) {
	response := KernelspecResponse{
		// Jupyter Server's default_kernel_name, which is python3 whether or not one is installed.
		Default:    "python3",
		Kernespecs: make(map[string]KernelspecModel),
	}

	for kernelName, kernelInfo := range GetAllSpecs() {
		response.Kernespecs[kernelName] = kernelspecModel(kernelName, kernelInfo.Spec)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// EnvironmentSetupHandler starts setting up the project's .venv: 202 with the job's state when it
// starts, 409 with it when one is already running.
func EnvironmentSetupHandler(w http.ResponseWriter, req *http.Request) {
	status := http.StatusAccepted
	if err := StartSetup(core.Zasper.HomeDir); errors.Is(err, ErrSetupRunning) {
		status = http.StatusConflict
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(CurrentSetup())
}

func EnvironmentSetupStatusHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(CurrentSetup())
}
