package content

import (
	"encoding/json"
	"fmt"
	"strings"
)

/*
MultilineText is nbformat's "multiline string": a JSON string or a list of strings, which mean the
same text. The format allows either, so decoding has to accept both — a bare []string makes a
string-valued `source` an unmarshal error.
*/
type MultilineText []string

func (m *MultilineText) UnmarshalJSON(data []byte) error {
	var lines []string
	if err := json.Unmarshal(data, &lines); err == nil {
		*m = lines
		return nil
	}

	var single string
	if err := json.Unmarshal(data, &single); err != nil {
		return fmt.Errorf("expected a string or a list of strings, got %s", string(data))
	}

	// Kept as one element: everything here is joined with "" on the way out, and the write path
	// splits on newlines again.
	*m = MultilineText{single}
	return nil
}

func _isJSONMime(mime string) bool {
	// _isJSONMime checks if a MIME type is JSON.
	return mime == "application/json" || (strings.HasPrefix(mime, "application/") && strings.HasSuffix(mime, "+json"))
}

func parseNotebook(nb NotebookDisk) Notebook {
	outNb := rejoinLines(nb)
	stripTransient(&nb)
	return outNb
}

func rejoinMimeBundle(data map[string]interface{}) map[string]interface{} {
	// rejoinMimeBundle rejoins multi-line string fields in a mimebundle.
	outData := make(map[string]interface{})
	for key, value := range data {
		if !_isJSONMime(key) {
			if valueList, ok := value.([]interface{}); ok {
				allStrings := true
				for _, v := range valueList {
					if _, ok := v.(string); !ok {
						allStrings = false
						break
					}
				}
				if allStrings {
					joined := strings.Join(toStringSlice(valueList), "")
					outData[key] = joined
				}

			} else {
				outData[key] = fmt.Sprintf("%v", value)
			}
		} else {
			outData[key] = fmt.Sprintf("%v", value)
		}

	}
	return outData
}

// convert notebook disk from json to be rendered to outside world
func rejoinLines(nbDisk NotebookDisk) Notebook {
	nb := Notebook{
		Metadata:      nbDisk.Metadata,
		Nbformat:      nbDisk.Nbformat,
		NbformatMinor: nbDisk.NbformatMinor,
	}
	for _, cell := range nbDisk.Cells {
		data := ""

		var outputData []Output
		if cell.Source != nil {
			data = strings.Join(cell.Source, "")
		}

		attachmentData := rejoinMimeBundle(cell.Attachments)

		if cell.CellType == "code" {
			for _, output := range cell.Outputs {

				x := Output{
					OutputType:     output.OutputType,
					ExecutionCount: output.ExecutionCount,
					Metadata:       output.Metadata,
					Text:           strings.Join(output.Text, ""),
				}

				if output.OutputType == "error" {
					x.Ename = output.Ename
					x.Evalue = output.Evalue
					x.Traceback = output.Traceback
				}

				switch output.OutputType {
				case "execute_result", "display_data":
					x.Data = rejoinMimeBundle(output.Data)
				case "stream":
					if output.Text != nil {
						x.Text = strings.Join(output.Text, "")
					}
				default:
					x.Data = rejoinMimeBundle(output.Data)
				}
				outputData = append(outputData, x)
			}
		}
		nb.Cells = append(nb.Cells,
			Cell{Source: data,
				CellType:       cell.CellType,
				ExecutionCount: cell.ExecutionCount,
				CellMetadata:   cell.CellMetadata,
				Attachments:    attachmentData,
				Outputs:        outputData,
			})
	}
	return nb
}

// splitMimeBundle splits multi-line string fields in a mimebundle.
func splitMimeBundle(data map[string]interface{}) map[string]interface{} {
	diskData := make(map[string]interface{})
	nonTextSplitMimes := map[string]bool{
		"application/javascript": false,
		"image/svg+xml":          false,
		"application/json":       false,
	}

	for key, value := range data {
		// if str, ok := value.(string); ok {
		if strings.HasPrefix(key, "text/") || nonTextSplitMimes[key] {
			strVal, ok := value.(string)
			if ok {
				splitValue := strings.SplitAfter(strVal, "\n")

				// Trim the last element to remove the trailing newline
				if len(splitValue) > 0 {
					splitValue[len(splitValue)-1] = strings.TrimSuffix(splitValue[len(splitValue)-1], "\n")
				}

				diskData[key] = splitValue
			} else {
				// If not a string, just assign the value as is
				diskData[key] = value
			}
		} else {
			diskData[key] = value
		}
	}
	return diskData
}

// splitLines splits likely multi-line text into lists of strings.
func convertToNbDisk(nb Notebook) NotebookDisk {
	nbDisk := NotebookDisk{
		Cells: []CellDisk{},
		// Never nil: nbformat requires `metadata` to be an object, and a client that sends none would
		// otherwise have `"metadata": null` written to disk.
		Metadata:      NotebookMetadata{},
		Nbformat:      4,
		NbformatMinor: 5,
	}
	if nb.Metadata != nil {
		nbDisk.Metadata = nb.Metadata
	}
	// Keep the document's own version when the client sent one back, rather than relabelling every
	// save as 4.5.
	if nb.Nbformat != 0 {
		nbDisk.Nbformat = nb.Nbformat
	}
	if nb.NbformatMinor != 0 {
		nbDisk.NbformatMinor = nb.NbformatMinor
	}
	for _, outCell := range nb.Cells {
		// Convert string slice to []interface{}
		sourceLines := strings.SplitAfter(outCell.Source, "\n")

		// Convert attachments map
		attachments := make(map[string]interface{})
		for k, v := range outCell.Attachments {
			if str, ok := v.(string); ok {
				attachments[k] = map[string]string{"data": str}
			} else {
				attachments[k] = map[string]string{"data": fmt.Sprintf("%v", v)}
			}
		}

		// Convert outputs
		outputsDisk := make([]OutputDisk, len(outCell.Outputs))
		for i, out := range outCell.Outputs {
			outputsDisk[i] = OutputDisk{
				OutputType:     out.OutputType,
				ExecutionCount: out.ExecutionCount,
				Data:           splitMimeBundle(out.Data),
				Text:           strings.SplitAfter(out.Text, "\n"),
				Metadata:       out.Metadata,
			}
			if out.OutputType == "error" {
				outputsDisk[i].Ename = out.Ename
				outputsDisk[i].Evalue = out.Evalue
				outputsDisk[i].Traceback = out.Traceback
			}
		}

		cellMeta := outCell.CellMetadata
		if cellMeta == nil {
			cellMeta = map[string]interface{}{}
		}

		nbDisk.Cells = append(nbDisk.Cells, CellDisk{
			Source:         sourceLines,
			CellType:       outCell.CellType,
			ExecutionCount: outCell.ExecutionCount,
			Attachments:    attachments,
			Outputs:        outputsDisk,
			CellMetadata:   cellMeta,
		})
	}

	return nbDisk

}

// stripTransient removes transient metadata from the notebook.
func stripTransient(nb *NotebookDisk) *NotebookDisk {
	// todo
	// delete(nb.Metadata, "orig_nbformat")
	// delete(nb.Metadata, "orig_nbformat_minor")
	// delete(nb.Metadata, "signature")
	for _, cell := range nb.Cells {
		delete(cell.CellMetadata, "trusted")
	}
	return nb
}

// Helper function to convert interface{} to []string
func toStringSlice(input []interface{}) []string {
	result := make([]string, len(input))
	for i, v := range input {
		result[i] = v.(string)
	}
	return result
}

// Notebook struct to be stored on disk
type NotebookDisk struct {
	Cells         []CellDisk       `json:"cells"`
	Nbformat      int              `json:"nbformat"`
	NbformatMinor int              `json:"nbformat_minor"`
	Metadata      NotebookMetadata `json:"metadata"`
}

// Notebook struct that is rendered as json to outside world
type Notebook struct {
	Cells         []Cell           `json:"cells"`
	Nbformat      int              `json:"nbformat"`
	NbformatMinor int              `json:"nbformat_minor"`
	Metadata      NotebookMetadata `json:"metadata"`
}

// Cell struct for handling individual cells in a notebook
type CellDisk struct {
	Source         MultilineText          `json:"source"`
	ExecutionCount int                    `json:"execution_count"`
	CellType       string                 `json:"cell_type"`
	Attachments    map[string]interface{} `json:"attachments"`
	Outputs        []OutputDisk           `json:"outputs"`
	CellMetadata   map[string]interface{} `json:"metadata"`
}

type Cell struct {
	Source         string                 `json:"source"`
	ExecutionCount int                    `json:"execution_count"`
	CellType       string                 `json:"cell_type"`
	Attachments    map[string]interface{} `json:"attachments"`
	Outputs        []Output               `json:"outputs"`
	CellMetadata   map[string]interface{} `json:"metadata"`
}

/*
Notebook metadata is carried through opaquely. nbformat lets a writer put arbitrary keys here, and
the standard ones vary in shape: `kernelspec` is an object, and `language_info.codemirror_mode` is
sometimes a string and sometimes an object. A map round-trips all of it and cannot fail to decode.
*/
type NotebookMetadata map[string]interface{}

// Output struct for handling cell outputs
type OutputDisk struct {
	OutputType     string                 `json:"output_type"`
	ExecutionCount int                    `json:"execution_count"`
	Data           map[string]interface{} `json:"data"`
	Text           MultilineText          `json:"text"`
	Metadata       map[string]interface{} `json:"metadata"`
	// in case of error traceback
	Ename     string   `json:"ename,omitempty"`
	Evalue    string   `json:"evalue,omitempty"`
	Traceback []string `json:"traceback,omitempty"`
}

type Output struct {
	OutputType     string                 `json:"output_type,omitempty"`
	ExecutionCount int                    `json:"execution_count,omitempty"`
	Data           map[string]interface{} `json:"data,omitempty"`
	Text           string                 `json:"text,omitempty"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
	// in case of error traceback
	Ename     string   `json:"ename,omitempty"`
	Evalue    string   `json:"evalue,omitempty"`
	Traceback []string `json:"traceback,omitempty"`
}
