package kernelspec

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/mux"
)

func SingleKernelspecAPIHandler(w http.ResponseWriter, req *http.Request) {
	log.Println("Get request received")

	vars := mux.Vars(req)
	kernelName := vars["kernelName"]
	log.Println("kernelName :", kernelName)

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
