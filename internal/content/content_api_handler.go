package content

import (
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"net/http"
	"slices"
	"strconv"

	zhttp "github.com/zasper-io/zasper/internal/http"

	"github.com/rs/zerolog/log"
)

func ContentAPIHandler(w http.ResponseWriter, req *http.Request) {
	var body ContentRequestBody
	err := json.NewDecoder(req.Body).Decode(&body)
	log.Debug().Msgf("Content requested with payload: %+v", body)
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
		// A file that is missing and a file that cannot be parsed are different answers.
		if errors.Is(err, os.ErrNotExist) {
			zhttp.SendErrorResponse(w, http.StatusNotFound, "Content not found")
			return
		}
		// The reason alone: the editor shows this sentence to the reader, under its own heading.
		zhttp.SendErrorResponse(w, http.StatusBadRequest, err.Error())
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
		err = UpdateNbContent(body.Path, body.Type, body.Format, body.Content)

		if err != nil {
			log.Error().Err(err).Msg("Error saving notebook content")
			zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error saving notebook content: %v", err))
			return
		}
	}

	if body.Type == "file" {
		contentStr, ok := body.Content.(string)
		if !ok {
			log.Error().Msg("Invalid content type")
			zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid content type")
			return
		}
		err = UpdateContent(body.Path, body.Type, body.Format, contentStr)
		if err != nil {
			log.Error().Err(err).Msg("Error saving content")
			zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error saving content: %v", err))
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
}

func ContentDeleteAPIHandler(w http.ResponseWriter, req *http.Request) {
	var body ContentRequestBody
	err := json.NewDecoder(req.Body).Decode(&body)

	log.Debug().Msgf("%s", body)
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

	if err := deleteFile(body.Path); err != nil {
		log.Error().Err(err).Msg("Error deleting content")
		if errors.Is(err, os.ErrNotExist) {
			zhttp.SendErrorResponse(w, http.StatusNotFound, "Content not found")
			return
		}
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error deleting content: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

}

/*
OnContentMoved is called after a file or folder has moved, so whatever else keys on a path can
follow it — a running notebook's session, above all. A hook the app wires up rather than an import,
because the content package is about the filesystem and knows nothing about kernels.
*/
var OnContentMoved = func(from, to string) {}

func relocateSessions(from, to string) {
	if from != to {
		OnContentMoved(from, to)
	}
}

// hasTraversal is the guard the handlers here have always spelled inline. GetSafePath refuses an
// escape anyway; this answers before anything is attempted.
func hasTraversal(paths ...string) bool {
	for _, path := range paths {
		if strings.Contains(path, "..") {
			return true
		}
	}
	return false
}

// statusFor keeps the difference between "there is nothing there", "something is already there",
// "you may not" and "that request made no sense", all of which used to answer 400.
func statusFor(err error) int {
	switch {
	case errors.Is(err, os.ErrNotExist):
		return http.StatusNotFound
	case errors.Is(err, errTargetExists):
		return http.StatusConflict
	case errors.Is(err, os.ErrPermission):
		return http.StatusForbidden
	default:
		return http.StatusBadRequest
	}
}

func ContentCreateAPIHandler(w http.ResponseWriter, req *http.Request) {
	var contentPayload ContentPayload
	if err := json.NewDecoder(req.Body).Decode(&contentPayload); err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error creating content: %v", err))
		return
	}

	if hasTraversal(contentPayload.ParentDir) {
		log.Error().Msg("Invalid path")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	data, err := createContent(contentPayload)
	if err != nil {
		log.Error().Err(err).Msg("Error creating content")
		// The reason alone: the file browser shows this sentence to the reader.
		zhttp.SendErrorResponse(w, statusFor(err), err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(data)
}

func ContentRenameAPIHandler(w http.ResponseWriter, req *http.Request) {

	var renameContentPayload RenameContentPayload
	if err := json.NewDecoder(req.Body).Decode(&renameContentPayload); err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error renaming content: %v", err))
		return
	}

	oldName := renameContentPayload.OldName
	log.Debug().Msgf("old path : %s", oldName)

	if hasTraversal(renameContentPayload.ParentDir, oldName, renameContentPayload.NewName) {
		log.Error().Msg("Invalid path")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	if err := rename(renameContentPayload.ParentDir, oldName, renameContentPayload.NewName); err != nil {
		log.Error().Err(err).Msg("Error renaming content")
		// The reason alone: the file browser shows this sentence to the reader.
		zhttp.SendErrorResponse(w, statusFor(err), err.Error())
		return
	}

	relocateSessions(
		filepath.Join(renameContentPayload.ParentDir, oldName),
		filepath.Join(renameContentPayload.ParentDir, renameContentPayload.NewName),
	)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
}

func ContentMoveAPIHandler(w http.ResponseWriter, req *http.Request) {
	var payload MovePayload
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error moving content: %v", err))
		return
	}

	if hasTraversal(payload.From, payload.To) {
		log.Error().Msg("Invalid path")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	if err := moveContent(payload.From, payload.To); err != nil {
		log.Error().Err(err).Msg("Error moving content")
		zhttp.SendErrorResponse(w, statusFor(err), err.Error())
		return
	}

	relocateSessions(payload.From, payload.To)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
}

func ContentCopyAPIHandler(w http.ResponseWriter, req *http.Request) {
	var payload CopyPayload
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error copying content: %v", err))
		return
	}

	if hasTraversal(payload.From, payload.ToDir) {
		log.Error().Msg("Invalid path")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	data, err := copyContent(payload.From, payload.ToDir)
	if err != nil {
		log.Error().Err(err).Msg("Error copying content")
		zhttp.SendErrorResponse(w, statusFor(err), err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(data)
}

/*
ContentDownloadAPIHandler sends a file to the browser as an attachment. A GET with the path in the
query rather than a POST, because a download is a plain read and http.ServeContent can then answer a
range request — which is how a paused download resumes.

A directory is refused rather than zipped: building an archive of an arbitrary subtree is a different
feature, and answering with something other than what was asked for is worse than saying no.
*/
func ContentDownloadAPIHandler(w http.ResponseWriter, req *http.Request) {
	relativePath := req.URL.Query().Get("path")
	if relativePath == "" || hasTraversal(relativePath) {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	osPath := GetSafePath(relativePath)
	if osPath == "" {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	info, err := os.Stat(osPath)
	if err != nil {
		zhttp.SendErrorResponse(w, statusFor(err), "Content not found")
		return
	}
	if info.IsDir() {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "a folder cannot be downloaded")
		return
	}

	file, err := os.Open(osPath)
	if err != nil {
		zhttp.SendErrorResponse(w, statusFor(err), err.Error())
		return
	}
	defer file.Close()

	// mime.FormatMediaType encodes a name that is not plain ASCII, which a hand-written
	// `filename="..."` would either mangle or let a quote out of.
	name := filepath.Base(osPath)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeContent(w, req, name, info.ModTime(), file)
}

/*
UploadFileHandler takes one file per request rather than a batch, so that the browser can show a
progress bar and a reason per file, and so that one refused file does not take the rest of a folder
with it.

`relative_path` carries the file's path inside `parent_dir` for a folder upload; it defaults to the
name the multipart part came with. `replace` has to be asked for: answering 409 and letting the client
offer to replace is the difference between overwriting a file on purpose and doing it by accident.
*/
func UploadFileHandler(w http.ResponseWriter, r *http.Request) {
	// The memory limit, not a size limit: anything past it is spooled to a temp file by net/http.
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Unable to read the upload: %v", err))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "The request carried no file")
		return
	}
	defer file.Close()

	parentDir := r.FormValue("parent_dir")
	relativePath := r.FormValue("relative_path")
	if relativePath == "" {
		relativePath = header.Filename
	}

	if hasTraversal(parentDir, relativePath) {
		log.Error().Msg("Invalid path")
		zhttp.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	data, err := uploadContent(parentDir, relativePath, r.FormValue("replace") == "true", file)
	if err != nil {
		log.Error().Err(err).Msg("Error uploading content")
		zhttp.SendErrorResponse(w, statusFor(err), err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(data)
}
