package kernelspec

import (
	"errors"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/gorilla/mux"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/httpx"
)

// ResourceHandler serves one of a kernel's own files, such as its logo.
func (k *Catalog) ResourceHandler(w http.ResponseWriter, req *http.Request) {

	vars := mux.Vars(req)
	kernelName := vars["kernel"]
	resourcePath := vars["resource"]

	fullPath, ok := k.getResourceFile(kernelName, resourcePath)
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "File not found")
		return
	}

	resourceData, err := os.ReadFile(fullPath)
	if err != nil {
		log.Error().Msgf("Error reading file: %v", err)
		httpx.SendErrorResponse(w, http.StatusNotFound, "File not found")
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

// GetHandler answers Jupyter Server's model for one kernelspec, named as the URL has it.
func (k *Catalog) GetHandler(w http.ResponseWriter, req *http.Request) {

	vars := mux.Vars(req)
	kernelName := vars["kernelName"]

	kspec, err := k.Spec(kernelName)
	if errors.Is(err, ErrKernelspecNotFound) {
		httpx.SendErrorResponse(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}

	httpx.SendJSON(w, http.StatusOK, kernelspecModel(kernelName, kspec))
}

// ListHandler answers every kernelspec, as Jupyter Server's /api/kernelspecs does.
func (k *Catalog) ListHandler(w http.ResponseWriter, req *http.Request) {
	specs := k.Specs()
	response := KernelspecResponse{
		Default:     defaultKernelName(specs),
		Kernelspecs: make(map[string]KernelspecModel),
	}

	for kernelName, kernelInfo := range specs {
		response.Kernelspecs[kernelName] = kernelspecModel(kernelName, kernelInfo.Spec)
	}

	httpx.SendJSON(w, http.StatusOK, response)
}

// defaultKernelName answers a kernel that is installed: python3 when there is one, then the first Python
// by name, then the first kernel of any language, and "" when there is none at all.
func defaultKernelName(specs map[string]KspecData) string {
	if _, ok := specs["python3"]; ok {
		return "python3"
	}
	names := slices.Sorted(maps.Keys(specs))
	for _, name := range names {
		if strings.EqualFold(specs[name].Spec.Language, "python") {
			return name
		}
	}
	if len(names) > 0 {
		return names[0]
	}
	return ""
}

// SetupHandler starts setting up the project's .venv: 202 with the job's state when it
// starts, 409 with it when one is already running.
func (k *Catalog) SetupHandler(w http.ResponseWriter, req *http.Request) {
	status := http.StatusAccepted
	if err := k.StartSetup(k.project); errors.Is(err, ErrSetupRunning) {
		status = http.StatusConflict
	}
	httpx.SendJSON(w, status, k.CurrentSetup())
}

// SetupStatusHandler answers the state of the last setup.
func (k *Catalog) SetupStatusHandler(w http.ResponseWriter, req *http.Request) {
	httpx.SendJSON(w, http.StatusOK, k.CurrentSetup())
}
