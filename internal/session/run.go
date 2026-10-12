package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/zasper-io/zasper/internal/httpx"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/models"
	"github.com/zasper-io/zasper/internal/nbformat"
)

// ErrNoSuchCell answers a run of a cell the notebook does not have, or one that is not code.
var ErrNoSuchCell = errors.New("the notebook has no code cell with that id")

// How long a run is waited on by default, and at most. Past it the run carries on and is journalled.
const (
	defaultRunWait = 60 * time.Second
	maxRunWait     = 10 * time.Minute
)

/*
RunCell runs the code cell cellID of the notebook at path, as client, with no tab needed: on the kernel the
notebook already has, or on one started for it from the kernel its metadata names. See [kernel.KernelManager.Run]
for where the output goes.
*/
func (s *Sessions) RunCell(ctx context.Context, path, cellID, client string) (kernel.Run, error) {
	model, err := s.project.GetContent(path, "notebook", "")
	if err != nil {
		return kernel.Run{}, err
	}
	doc, _ := model.Content.(nbformat.Document)
	source, ok := codeCell(doc, cellID)
	if !ok {
		return kernel.Run{}, ErrNoSuchCell
	}

	session, running := s.forPath(path, "")
	if _, alive := s.kernels.Get(session.Kernel.Id); !running || !alive {
		session, err = s.Create(models.SessionModel{
			Path:        path,
			Name:        filepath.Base(path),
			SessionType: "notebook",
			Kernel:      models.KernelModel{Name: s.kernelFor(doc)},
		})
		if err != nil {
			return kernel.Run{}, err
		}
	}
	km, ok := s.kernels.Get(session.Kernel.Id)
	if !ok {
		return kernel.Run{}, fmt.Errorf("the kernel for %s stopped", path)
	}
	return km.Run(ctx, cellID, client, source)
}

func codeCell(doc nbformat.Document, cellID string) (string, bool) {
	for _, cell := range doc.Cells() {
		if cell["id"] == cellID && cell["cell_type"] == "code" {
			source, _ := cell["source"].(string)
			return source, true
		}
	}
	return "", false
}

// kernelFor is the kernel the notebook names, or the default when it names none.
func (s *Sessions) kernelFor(doc nbformat.Document) string {
	spec, _ := doc.Metadata()["kernelspec"].(map[string]interface{})
	if name, _ := spec["name"].(string); name != "" {
		return name
	}
	if s.defaultKernel != nil {
		return s.defaultKernel()
	}
	return ""
}

// RunRequest asks for a cell to be run. Wait is how many seconds to wait for it to finish.
type RunRequest struct {
	Path   string `json:"path"`
	CellID string `json:"cell_id"`
	Client string `json:"client"`
	Wait   int    `json:"wait"`
}

// RunCellHandler runs a cell and answers the run once it has finished, or 202 when it is still going.
func (s *Sessions) RunCellHandler(w http.ResponseWriter, req *http.Request) {
	var body RunRequest
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, fmt.Sprintf("Invalid request body: %v", err))
		return
	}
	wait := defaultRunWait
	if body.Wait > 0 {
		wait = min(time.Duration(body.Wait)*time.Second, maxRunWait)
	}
	ctx, cancel := context.WithTimeout(req.Context(), wait)
	defer cancel()

	run, err := s.RunCell(ctx, body.Path, body.CellID, body.Client)
	switch {
	case err == nil:
		httpx.SendJSON(w, http.StatusOK, run)
	case errors.Is(err, context.DeadlineExceeded):
		httpx.SendErrorResponse(w, http.StatusAccepted, "The run is still going; its output reaches open tabs, and the notebook once it ends.")
	case errors.Is(err, os.ErrNotExist):
		httpx.SendErrorResponse(w, http.StatusNotFound, "Content not found")
	case errors.Is(err, ErrNoSuchCell):
		httpx.SendErrorResponse(w, http.StatusNotFound, err.Error())
	default:
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
	}
}

// KernelFor is the kernel the notebook at path is running on, if any.
func (s *Sessions) KernelFor(path string) (*kernel.KernelManager, bool) {
	session, ok := s.forPath(path, "")
	if !ok {
		return nil, false
	}
	return s.kernels.Get(session.Kernel.Id)
}

// Restart replaces the kernel the notebook at path is running on with a new one of the same kind, as
// the notebook's restart button does: everything the old one held is gone. Open tabs follow the
// notebook's new session.
func (s *Sessions) Restart(path string) (models.SessionModel, error) {
	session, ok := s.forPath(path, "")
	if !ok {
		return models.SessionModel{}, fmt.Errorf("%s has no kernel running", path)
	}
	if err := s.Delete(session.Id); err != nil {
		return models.SessionModel{}, err
	}
	return s.Create(models.SessionModel{
		Path:        path,
		Name:        session.Name,
		SessionType: session.SessionType,
		Kernel:      models.KernelModel{Name: session.Kernel.Name},
	})
}
