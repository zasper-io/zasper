package content

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/atomicfile"
	"github.com/zasper-io/zasper/internal/nbformat"
)

// ErrCellNotFound is answered when the file has no cell the run can be told to belong to.
var ErrCellNotFound = errors.New("no cell in the notebook matches the run")

/*
WriteRunOutputs puts a finished run's outputs and execution count into the notebook on disk, and its times
into metadata.execution when execution is not nil, and changes nothing else in it.

The cell is found by id, or for a notebook older than nbformat 4.5, which keeps no ids, by being the one
code cell holding the code that ran. Two cells holding it is no answer, and the file is left alone.
*/
func (p Project) WriteRunOutputs(path, cellID, code string, executionCount interface{}, outputs []map[string]interface{}, execution map[string]string) error {
	osPath, err := p.savePath(path)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(osPath)
	if err != nil {
		return err
	}
	doc, err := nbformat.Read(data)
	if err != nil {
		return err
	}

	cell := runCell(doc.Cells(), cellID, code)
	if cell == nil {
		return ErrCellNotFound
	}
	written := make([]interface{}, len(outputs))
	for i, output := range outputs {
		written[i] = output
	}
	cell["outputs"] = written
	cell["execution_count"] = executionCount
	if execution != nil {
		metadata, _ := cell["metadata"].(map[string]interface{})
		if metadata == nil {
			metadata = map[string]interface{}{}
			cell["metadata"] = metadata
		}
		times := make(map[string]interface{}, len(execution))
		for key, value := range execution {
			times[key] = value
		}
		metadata["execution"] = times
	}

	for _, problem := range nbformat.Validate(nbformat.Normalize(doc)) {
		log.Warn().Msgf("writing a run's output into %s with something the notebook format does not allow: %s", path, problem)
	}
	encoded, err := nbformat.Marshal(doc)
	if err != nil {
		return err
	}
	if _, err := atomicfile.Write(osPath, bytes.NewReader(encoded), 0o644); err != nil {
		return fmt.Errorf("error writing notebook to path %s: %w", path, err)
	}
	return nil
}

func runCell(cells []map[string]interface{}, cellID, code string) map[string]interface{} {
	if cellID != "" {
		for _, cell := range cells {
			if id, _ := cell["id"].(string); id == cellID && cell["cell_type"] == "code" {
				return cell
			}
		}
	}

	ran := strings.TrimSpace(code)
	if ran == "" {
		return nil
	}
	var holding map[string]interface{}
	for _, cell := range cells {
		source, _ := cell["source"].(string)
		if cell["cell_type"] != "code" || strings.TrimSpace(source) != ran {
			continue
		}
		if holding != nil {
			return nil
		}
		holding = cell
	}
	return holding
}
