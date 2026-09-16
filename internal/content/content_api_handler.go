package content

import (
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"

	"net/http"
	"slices"

	"github.com/zasper-io/zasper/internal/httpx"

	"github.com/rs/zerolog/log"
)

func (h *Handler) Read(w http.ResponseWriter, req *http.Request) {
	var body ContentRequestBody
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}
	log.Debug().Msgf("content requested: %+v", body)

	relativePath := body.Path
	contentType := body.Type

	if relativePath == "" {
		relativePath = "."
	}

	allowedTypes := []string{"directory", "file", "notebook"}

	if !(slices.Contains(allowedTypes, contentType)) {
		contentType = "file"
	}

	if !slices.Contains([]string{"", "0", "1"}, body.Hash) {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("hash is 0 or 1, not %q", body.Hash))
		return
	}

	if h.project.outsideProject(relativePath) {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	// A file's format is passed through as asked, and not defaulted: an empty one lets the file's own
	// bytes decide between text and base64. A notebook is always JSON.
	contentModel, err := h.project.GetContent(relativePath, contentType, body.Format, body.Hash == "1")

	if err != nil {
		log.Error().Msgf("Error fetching content: %v", err)
		// A file that is missing and a file that cannot be parsed are different answers.
		if errors.Is(err, os.ErrNotExist) {
			httpx.SendErrorResponse(w, http.StatusNotFound, "Content not found")
			return
		}
		// The reason alone: the editor shows this sentence to the reader, under its own heading.
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}

	httpx.SendJSON(w, http.StatusOK, contentModel)
}

func (h *Handler) Update(w http.ResponseWriter, req *http.Request) {
	var body ContentUpdateRequest
	err := json.NewDecoder(req.Body).Decode(&body)

	if err != nil {
		log.Error().Err(err).Msg("Error decoding request body")
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error updating content: %v", err))
		return
	}

	if h.project.outsideProject(body.Path) {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	switch body.Type {
	case "notebook":
		err = h.project.UpdateNbContent(body.Path, body.Type, body.Format, body.Content)

		if err != nil {
			log.Error().Err(err).Msg("Error saving notebook content")
			httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error saving notebook content: %v", err))
			return
		}
	case "file":
		contentStr, ok := body.Content.(string)
		if !ok {
			log.Error().Msg("Invalid content type")
			httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid content type")
			return
		}
		err = h.project.UpdateContent(body.Path, body.Type, body.Format, contentStr)
		if err != nil {
			log.Error().Err(err).Msg("Error saving content")
			httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error saving content: %v", err))
			return
		}
	default:
		// Answering 200 here told a client whose save wrote nothing that it had worked.
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Cannot save content of type %q", body.Type))
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) Delete(w http.ResponseWriter, req *http.Request) {
	var body ContentRequestBody
	err := json.NewDecoder(req.Body).Decode(&body)
	if err != nil {
		log.Error().Err(err).Msg("Error decoding request body")
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error deleting content: %v", err))
		return
	}

	if h.project.outsideProject(body.Path) {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	if err := h.project.deleteFile(body.Path); err != nil {
		log.Error().Err(err).Msg("Error deleting content")
		if errors.Is(err, os.ErrNotExist) {
			httpx.SendErrorResponse(w, http.StatusNotFound, "Content not found")
			return
		}
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error deleting content: %v", err))
		return
	}

	w.WriteHeader(http.StatusOK)
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

func (h *Handler) Create(w http.ResponseWriter, req *http.Request) {
	var contentPayload ContentPayload
	if err := json.NewDecoder(req.Body).Decode(&contentPayload); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error creating content: %v", err))
		return
	}

	if h.project.outsideProject(contentPayload.ParentDir) {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	data, err := h.project.createContent(contentPayload)
	if err != nil {
		log.Error().Err(err).Msg("Error creating content")
		// The reason alone: the file browser shows this sentence to the reader.
		httpx.SendErrorResponse(w, statusFor(err), err.Error())
		return
	}

	httpx.SendJSON(w, http.StatusCreated, data)
}

func (h *Handler) Rename(w http.ResponseWriter, req *http.Request) {

	var renameContentPayload RenameContentPayload
	if err := json.NewDecoder(req.Body).Decode(&renameContentPayload); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error renaming content: %v", err))
		return
	}

	oldName := renameContentPayload.OldName
	log.Debug().Msgf("old path : %s", oldName)

	parentDir := renameContentPayload.ParentDir
	if h.project.outsideProject(parentDir, filepath.Join(parentDir, oldName), filepath.Join(parentDir, renameContentPayload.NewName)) {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	if err := h.project.rename(renameContentPayload.ParentDir, oldName, renameContentPayload.NewName); err != nil {
		log.Error().Err(err).Msg("Error renaming content")
		// The reason alone: the file browser shows this sentence to the reader.
		httpx.SendErrorResponse(w, statusFor(err), err.Error())
		return
	}

	h.moved(
		filepath.Join(renameContentPayload.ParentDir, oldName),
		filepath.Join(renameContentPayload.ParentDir, renameContentPayload.NewName),
	)

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) Move(w http.ResponseWriter, req *http.Request) {
	var payload MovePayload
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error moving content: %v", err))
		return
	}

	if h.project.outsideProject(payload.From, payload.To) {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	if err := h.project.moveContent(payload.From, payload.To); err != nil {
		log.Error().Err(err).Msg("Error moving content")
		httpx.SendErrorResponse(w, statusFor(err), err.Error())
		return
	}

	h.moved(payload.From, payload.To)

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) Copy(w http.ResponseWriter, req *http.Request) {
	var payload CopyPayload
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Error copying content: %v", err))
		return
	}

	if h.project.outsideProject(payload.From, payload.ToDir) {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	data, err := h.project.copyContent(payload.From, payload.ToDir)
	if err != nil {
		log.Error().Err(err).Msg("Error copying content")
		httpx.SendErrorResponse(w, statusFor(err), err.Error())
		return
	}

	httpx.SendJSON(w, http.StatusCreated, data)
}

/*
Download sends a file to the browser as an attachment. A GET with the path in the
query rather than a POST, because a download is a plain read and http.ServeContent can then answer a
range request — which is how a paused download resumes.

A directory is refused rather than zipped: building an archive of an arbitrary subtree is a different
feature, and answering with something other than what was asked for is worse than saying no.
*/
func (h *Handler) Download(w http.ResponseWriter, req *http.Request) {
	relativePath := req.URL.Query().Get("path")
	osPath := h.project.SafePath(relativePath)
	if relativePath == "" || osPath == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	info, err := os.Stat(osPath)
	if err != nil {
		httpx.SendErrorResponse(w, statusFor(err), "Content not found")
		return
	}
	if info.IsDir() {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "a folder cannot be downloaded")
		return
	}

	file, err := os.Open(osPath)
	if err != nil {
		httpx.SendErrorResponse(w, statusFor(err), err.Error())
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
Upload takes one file per request rather than a batch, so that the browser can show a
progress bar and a reason per file, and so that one refused file does not take the rest of a folder
with it.

`relative_path` carries the file's path inside `parent_dir` for a folder upload; it defaults to the
name the multipart part came with. `replace` has to be asked for: answering 409 and letting the client
offer to replace is the difference between overwriting a file on purpose and doing it by accident.
*/
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	// The memory limit, not a size limit: anything past it is spooled to a temp file by net/http.
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Unable to read the upload: %v", err))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "The request carried no file")
		return
	}
	defer file.Close()

	parentDir := r.FormValue("parent_dir")
	relativePath := r.FormValue("relative_path")
	if relativePath == "" {
		relativePath = header.Filename
	}

	if h.project.outsideProject(parentDir, filepath.Join(parentDir, relativePath)) {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	data, err := h.project.uploadContent(parentDir, relativePath, r.FormValue("replace") == "true", file)
	if err != nil {
		log.Error().Err(err).Msg("Error uploading content")
		httpx.SendErrorResponse(w, statusFor(err), err.Error())
		return
	}

	httpx.SendJSON(w, http.StatusCreated, data)
}

/*
Edits applies a language server's edits to files no editor holds, which is the half of a rename or a quick
fix that reaches beyond the open tabs. Each file answers for itself: what was applied, or why not.
*/
func (h *Handler) Edits(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Files []FileEdits `json:"files"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}
	httpx.SendJSON(w, http.StatusOK, map[string]any{"files": h.project.ApplyEdits(body.Files)})
}
