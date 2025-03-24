package content

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"net/http"
	"slices"
	"strconv"

	"github.com/zasper-io/zasper/internal/core"
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

	if strings.Contains(relativePath, "..") {
		log.Error().Msg("Invalid path")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	contentModel, err := GetContent(relativePath, contentType, format, hash)

	if err != nil {
		log.Error().Msgf("Error fetching content: %v", err)
		zhttp.SendErrorResponse(w, http.StatusNotFound, "Content not found")
		return
	}

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

	if strings.Contains(body.Path, "..") {
		log.Error().Msg("Invalid path")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
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

	if strings.Contains(body.Path, "..") {
		log.Error().Msg("Invalid path")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	deleteFile(body.Path)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

}

func ContentCreateAPIHandler(w http.ResponseWriter, req *http.Request) {
	var contentPayload ContentPayload
	_ = json.NewDecoder(req.Body).Decode(&contentPayload)

	if strings.Contains(contentPayload.ParentDir, "..") {
		log.Error().Msg("Invalid path")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

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

	if strings.Contains(renameContentPayload.ParentDir, "..") || strings.Contains(oldName, "..") || strings.Contains(renameContentPayload.NewName, "..") {
		log.Error().Msg("Invalid path")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	rename(renameContentPayload.ParentDir, oldName, renameContentPayload.NewName)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
}

func NewErrorResponse(w http.ResponseWriter, i int, s string) {
	panic("unimplemented")
}

func UploadFileHandler(w http.ResponseWriter, r *http.Request) {
	// Parse the form data (including file uploads)
	err := r.ParseMultipartForm(10 << 20) // 10 MB limit for file uploads
	if err != nil {
		http.Error(w, "Unable to parse form", http.StatusBadRequest)
		return
	}

	// Get the file from the form input
	file, fileHeader, err := r.FormFile("file") // "file" is the field name in the form
	if err != nil {
		http.Error(w, "Unable to read file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	fileName := fileHeader.Filename
	parentPath := r.FormValue("parentPath")

	// Save the file to the disk
	dst := filepath.Join(core.Zasper.HomeDir, parentPath, fileName)
	out, err := os.Create(dst)
	if err != nil {
		http.Error(w, "Unable to create file", http.StatusInternalServerError)
		return
	}
	defer out.Close()

	// Copy the uploaded file to the destination file
	_, err = io.Copy(out, file)
	if err != nil {
		http.Error(w, "Error saving file", http.StatusInternalServerError)
		return
	}

	// Return success response
	w.WriteHeader(http.StatusOK)
	log.Info().Msgf("File uploaded successfully to %s", dst)
}
