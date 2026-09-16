package search

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/httpx"
	"github.com/zasper-io/zasper/internal/nbformat"
)

// Summary is the last line of a search: how much it found, and whether it stopped at maxMatches.
type Summary struct {
	Files   int  `json:"files"`
	Matches int  `json:"matches"`
	Capped  bool `json:"capped"`
}

type searchEvent struct {
	File *FileMatches `json:"file,omitempty"`
	Done *Summary     `json:"done,omitempty"`
}

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	if err := json.NewDecoder(r.Body).Decode(into); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "The request body is not valid JSON.")
		return false
	}
	return true
}

func (h *Handler) runFor(w http.ResponseWriter, query Query) (*run, bool) {
	run, err := newRun(h.project.Root(), query)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return nil, false
	}
	return run, true
}

/*
Search answers the files whose contents match a query, one JSON object per line as each file is found, then
a summary. The client cancels a search by going away: the request's context stops the walk and ripgrep.
*/
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	var query Query
	if !decode(w, r, &query) {
		return
	}
	run, ok := h.runFor(w, query)
	if !ok {
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	encoder := json.NewEncoder(w)
	send := func(event searchEvent) {
		_ = encoder.Encode(event)
		if flusher != nil {
			flusher.Flush()
		}
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	found := make(chan FileMatches)
	go run.find(ctx, h.ripgrep, found)

	summary := Summary{}
	for file := range found {
		if summary.Capped {
			continue
		}
		if summary.Matches+file.count() >= maxMatches {
			file = file.truncated(maxMatches - summary.Matches)
			summary.Capped = summary.Matches+file.count() == maxMatches
			if summary.Capped {
				cancel()
			}
		}
		if len(file.Lines) == 0 {
			continue
		}
		summary.Files++
		summary.Matches += file.count()
		send(searchEvent{File: &file})
	}
	if r.Context().Err() == nil {
		send(searchEvent{Done: &summary})
	}
}

type bufferRequest struct {
	Query Query  `json:"query"`
	Path  string `json:"path"`
	Text  string `json:"text"`
}

/*
Buffer answers the matches in text the client sends for one file.

A search reads the disk, and a file open in an editor may hold unsaved text the reader is looking at; the
panel asks again for those files, so that both answers come from this one engine rather than from a second
one written in the browser.
*/
func (h *Handler) Buffer(w http.ResponseWriter, r *http.Request) {
	var request bufferRequest
	if !decode(w, r, &request) {
		return
	}
	if request.Path == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "A path is required.")
		return
	}
	run, ok := h.runFor(w, request.Query)
	if !ok {
		return
	}
	kind := "file"
	if isNotebook(request.Path) {
		kind = "notebook"
	}
	answer := FileMatches{Path: request.Path, Kind: kind, Lines: []LineMatch{}}
	if found := run.fileMatches(request.Path, []byte(request.Text)); found != nil {
		answer = found.truncated(maxMatches)
	}
	httpx.SendJSON(w, http.StatusOK, answer)
}

type previewRequest struct {
	Query Query      `json:"query"`
	Path  string     `json:"path"`
	Skip  []MatchKey `json:"skip"`
}

type previewResponse struct {
	Original string `json:"original"`
	Replaced string `json:"replaced"`
}

// Preview answers a text file as it is on disk and as a replace would leave it, for the diff tab.
func (h *Handler) Preview(w http.ResponseWriter, r *http.Request) {
	var request previewRequest
	if !decode(w, r, &request) {
		return
	}
	if request.Query.Replace == nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "A replacement is required.")
		return
	}
	run, ok := h.runFor(w, request.Query)
	if !ok {
		return
	}
	osPath := h.project.SafePath(request.Path)
	if osPath == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "The path is outside the project.")
		return
	}
	before, after, _, err := run.replaced(osPath, request.Path, request.Skip)
	if errors.Is(err, os.ErrNotExist) {
		httpx.SendErrorResponse(w, http.StatusNotFound, request.Path+" no longer exists.")
		return
	}
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, previewResponse{Original: before, Replaced: after})
}

// ReplaceFile is one file a replace writes, and the matches in it the reader left out.
type ReplaceFile struct {
	Path string     `json:"path"`
	Skip []MatchKey `json:"skip"`
}

type replaceRequest struct {
	Query Query         `json:"query"`
	Files []ReplaceFile `json:"files"`
}

type replaceFailure struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

type replaceResponse struct {
	Files        int              `json:"files"`
	Replacements int              `json:"replacements"`
	Failed       []replaceFailure `json:"failed"`
}

/*
Replace writes the replacement into files that are not open in an editor — the panel carries out the ones
that are in the editor itself, where the change can be undone. A file that fails is reported and the rest
are still written.
*/
func (h *Handler) Replace(w http.ResponseWriter, r *http.Request) {
	var request replaceRequest
	if !decode(w, r, &request) {
		return
	}
	if request.Query.Replace == nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "A replacement is required.")
		return
	}
	run, ok := h.runFor(w, request.Query)
	if !ok {
		return
	}

	response := replaceResponse{Failed: []replaceFailure{}}
	for _, file := range request.Files {
		count, err := h.replaceFile(run, file)
		if err != nil {
			log.Info().Err(err).Str("path", file.Path).Msg("could not replace in a file")
			response.Failed = append(response.Failed, replaceFailure{Path: file.Path, Message: err.Error()})
			continue
		}
		if count > 0 {
			response.Files++
			response.Replacements += count
		}
	}
	httpx.SendJSON(w, http.StatusOK, response)
}

func (h *Handler) replaceFile(run *run, file ReplaceFile) (int, error) {
	osPath := h.project.SafePath(file.Path)
	if osPath == "" {
		return 0, errors.New("the path is outside the project")
	}
	if !isNotebook(file.Path) {
		_, after, count, err := run.replaced(osPath, file.Path, file.Skip)
		if err != nil || count == 0 {
			return 0, err
		}
		return count, h.project.UpdateContent(file.Path, "file", "text", after)
	}

	data, err := os.ReadFile(osPath)
	if err != nil {
		return 0, err
	}
	doc, count, err := run.replacedNotebook(data, file.Skip)
	if err != nil || count == 0 {
		return 0, err
	}
	return count, h.project.UpdateNbContent(file.Path, "notebook", "json", map[string]interface{}(nbformat.Document(doc)))
}
