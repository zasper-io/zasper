package content

import (
	"encoding/json"
	"fmt"

	"net/http"
	"slices"
	"strconv"

	zhttp "github.com/zasper-io/zasper/internal/http"

	"github.com/rs/zerolog/log"
)

func ContentAPIHandler(w http.ResponseWriter, req *http.Request) {
	var body ContentRequestBody
	err := json.NewDecoder(req.Body).Decode(&body)
	log.Info().Msgf("Content requested with payload: %+v", body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	relativePath := body.Path
	contentType := body.Type
	format := body.Format
	hash_str := body.Hash

	if relativePath == "" {
		relativePath = "."
	}
	log.Print("path :", relativePath)

	allowedTypes := []string{"directory", "file", "notebook"}
	allowedFormats := []string{"text", "base64"}
	allowedHashes := []int{0, 1}

	if !(slices.Contains(allowedTypes, contentType)) {
		contentType = "file"
	}

	if !(slices.Contains(allowedFormats, format)) {
		format = "base64"
	}

	if hash_str == "" {
		hash_str = "0"
	}

	hash, err := strconv.Atoi(hash_str)
	if err != nil {
		log.Error().Err(err).Msg("")
	}

	if !(slices.Contains(allowedHashes, hash)) {
		hash = 0
	}

	contentModel := GetContent(relativePath, contentType, format, hash)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(contentModel)
}

func ContentUpdateAPIHandler(w http.ResponseWriter, req *http.Request) {
	var body ContentUpdateRequest
	err := json.NewDecoder(req.Body).Decode(&body)

	if err != nil {
		log.Error().Err(err).Msg("Error decoding request body")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error updating content: %v", err))
		return
	}

	if body.Type == "notebook" {
		UpdateNbContent(body.Path, body.Type, body.Format, body.Content)
	}

	if body.Type == "file" {
		contentStr, ok := body.Content.(string)
		if !ok {
			log.Error().Msg("Invalid content type")
			zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid content type")
			return
		}
		UpdateContent(body.Path, body.Type, body.Format, contentStr)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
}

func ContentDeleteAPIHandler(w http.ResponseWriter, req *http.Request) {
	var body ContentRequestBody
	err := json.NewDecoder(req.Body).Decode(&body)

	log.Info().Msgf("%s", body)
	if err != nil {
		log.Error().Err(err).Msg("Error decoding request body")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error deleting content: %v", err))
		return
	}

	deleteFile(body.Path)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

}

func ContentCreateAPIHandler(w http.ResponseWriter, req *http.Request) {
	var contentPayload ContentPayload
	_ = json.NewDecoder(req.Body).Decode(&contentPayload)

	data := createContent(contentPayload)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(data)
}

func ContentRenameAPIHandler(w http.ResponseWriter, req *http.Request) {

	var renameContentPayload RenameContentPayload
	_ = json.NewDecoder(req.Body).Decode(&renameContentPayload)

	oldName := renameContentPayload.OldName
	log.Info().Msgf("old path : %s", oldName)

	rename(renameContentPayload.ParentDir, oldName, renameContentPayload.NewName)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
}

func NewErrorResponse(w http.ResponseWriter, i int, s string) {
	panic("unimplemented")
}
