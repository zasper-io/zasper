package kernelspec

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gorilla/mux"
	"github.com/rs/zerolog/log"

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

func SingleKernelspecAPIHandler(w http.ResponseWriter, req *http.Request) {

	vars := mux.Vars(req)
	kernelName := vars["kernelName"]

	kspec := GetKernelSpec(kernelName)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(kspec)
}

func KernelspecAPIHandler(w http.ResponseWriter, req *http.Request) {
	response := KernelspecResponse{
		Default:    "python3",
		Kernespecs: make(map[string]KernelspecModel),
	}

	available_kernelspec := GetAllSpecs()

	for kernelName, kernelInfo := range available_kernelspec {
		response.Kernespecs[kernelName] = KernelspecModel{
			Name:      kernelName,
			Spec:      kernelInfo.Spec,
			Resources: getResources(kernelName, kernelInfo.ResourceDir),
		}

	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}
