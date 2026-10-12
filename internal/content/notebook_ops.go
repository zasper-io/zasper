package content

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/zasper-io/zasper/internal/atomicfile"
	"github.com/zasper-io/zasper/internal/models"
	"github.com/zasper-io/zasper/internal/nbformat"
)

// ErrNoCellIDs answers operations on a notebook older than nbformat 4.5, whose cells have no ids to name.
var ErrNoCellIDs = errors.New("the notebook is older than nbformat 4.5, so its cells have no ids to name")

/*
NotebookOp is one change to a notebook's cells, named by id rather than by position, so it means the same
thing whatever else has changed in the notebook since the caller read it.

	insert  a new cell of CellType holding Source, after the cell After, or first when After is empty
	edit    the Source of cell ID; its outputs stay, as after any edit
	delete  cell ID
	move    cell ID to after the cell After, or to the top when After is empty
*/
type NotebookOp struct {
	Op       string `json:"op"`
	ID       string `json:"id,omitempty"`
	After    string `json:"after,omitempty"`
	CellType string `json:"cell_type,omitempty"`
	Source   string `json:"source,omitempty"`
}

/*
ApplyNotebookOps carries out ops on the notebook at path, in order, and writes it once. It answers the hash
of what was written and the id of each cell an insert made, in order. Nothing is written when any op cannot
be carried out.
*/
func (p Project) ApplyNotebookOps(path string, ops []NotebookOp) (string, []string, error) {
	osPath, err := p.savePath(path)
	if err != nil {
		return "", nil, err
	}
	data, err := os.ReadFile(osPath)
	if err != nil {
		return "", nil, err
	}
	doc, err := nbformat.Read(data)
	if err != nil {
		return "", nil, err
	}
	if _, minor := doc.Version(); minor < 5 {
		return "", nil, ErrNoCellIDs
	}

	cells := doc.Cells()
	var inserted []string
	for i, op := range ops {
		cells, err = applyOp(doc, cells, op, &inserted)
		if err != nil {
			return "", nil, fmt.Errorf("operation %d (%s): %w", i+1, op.Op, err)
		}
	}
	list := make([]interface{}, len(cells))
	for i, cell := range cells {
		list[i] = cell
	}
	doc["cells"] = list

	encoded, err := nbformat.Marshal(doc)
	if err != nil {
		return "", nil, err
	}
	if _, err := atomicfile.Write(osPath, bytes.NewReader(encoded), 0o644); err != nil {
		return "", nil, fmt.Errorf("error writing notebook to path %s: %w", path, err)
	}
	return contentHash(encoded), inserted, nil
}

func applyOp(doc nbformat.Document, cells []map[string]interface{}, op NotebookOp, inserted *[]string) ([]map[string]interface{}, error) {
	switch op.Op {
	case "insert":
		cell, err := newCell(doc, op.CellType, op.Source)
		if err != nil {
			return nil, err
		}
		at, err := after(cells, op.After)
		if err != nil {
			return nil, err
		}
		*inserted = append(*inserted, cell["id"].(string))
		// The cells already in doc have to be seen by NewCellID for the next insert in the same batch.
		doc["cells"] = append(doc["cells"].([]interface{}), cell)
		return append(cells[:at], append([]map[string]interface{}{cell}, cells[at:]...)...), nil
	case "edit":
		i, err := indexOf(cells, op.ID)
		if err != nil {
			return nil, err
		}
		cells[i]["source"] = op.Source
		return cells, nil
	case "delete":
		i, err := indexOf(cells, op.ID)
		if err != nil {
			return nil, err
		}
		return append(cells[:i], cells[i+1:]...), nil
	case "move":
		i, err := indexOf(cells, op.ID)
		if err != nil {
			return nil, err
		}
		cell := cells[i]
		rest := append(append([]map[string]interface{}{}, cells[:i]...), cells[i+1:]...)
		at, err := after(rest, op.After)
		if err != nil {
			return nil, err
		}
		return append(rest[:at], append([]map[string]interface{}{cell}, rest[at:]...)...), nil
	default:
		return nil, fmt.Errorf("unknown operation %q", op.Op)
	}
}

func newCell(doc nbformat.Document, cellType, source string) (map[string]interface{}, error) {
	cell := map[string]interface{}{
		"id":        nbformat.NewCellID(doc),
		"cell_type": cellType,
		"metadata":  map[string]interface{}{},
		"source":    source,
	}
	switch cellType {
	case "code":
		cell["outputs"] = []interface{}{}
		cell["execution_count"] = nil
	case "markdown", "raw":
	default:
		return nil, fmt.Errorf("a cell is code, markdown or raw, not %q", cellType)
	}
	return cell, nil
}

func indexOf(cells []map[string]interface{}, id string) (int, error) {
	for i, cell := range cells {
		if cell["id"] == id {
			return i, nil
		}
	}
	return 0, fmt.Errorf("no cell has the id %q", id)
}

// after is where a cell placed after the one with id goes: the top for an empty id.
func after(cells []map[string]interface{}, id string) (int, error) {
	if id == "" {
		return 0, nil
	}
	i, err := indexOf(cells, id)
	return i + 1, err
}

// Notebook reads the notebook at path, with its hash.
func (h *Handler) Notebook(path string) (models.ContentModel, error) {
	if h.project.outsideProject(path) {
		return models.ContentModel{}, errors.New("invalid path")
	}
	return h.project.GetContent(path, "notebook", "")
}

// Notebooks lists the project's notebooks, relative to it, leaving out what the file browser dims.
func (h *Handler) Notebooks() ([]string, error) {
	root := h.project.Root()
	ignores := NewProjectIgnores(root)
	var found []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if path != root && ignores.Skips(path, entry.IsDir()) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".ipynb") {
			rel, err := filepath.Rel(root, path)
			if err == nil {
				found = append(found, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	return found, err
}

// ReadText reads a file in the project as text, for an agent: what an open tab holds that it has not
// saved, when one does, or else the file on disk.
func (h *Handler) ReadText(path string) (string, error) {
	if h.project.outsideProject(path) {
		return "", errors.New("invalid path")
	}
	if text, ok := h.watch.unsaved(path); ok {
		return text, nil
	}
	model, err := h.project.GetContent(path, "file", "text")
	if err != nil {
		return "", err
	}
	text, _ := model.Content.(string)
	return text, nil
}

// WriteTextAs writes a file in the project for client, locked like a save, and tells every open tab
// who wrote it.
func (h *Handler) WriteTextAs(path, content, client string) error {
	if h.project.outsideProject(path) {
		return errors.New("invalid path")
	}
	h.saving.Lock()
	defer h.saving.Unlock()
	hash, err := h.project.UpdateContent(path, "file", "text", content)
	if err != nil {
		return err
	}
	h.watch.wrote(path, hash, client)
	return nil
}
