package content

import (
	"fmt"
	"strings"
)

func _isJSONMime(mime string) bool {
	// _isJSONMime checks if a MIME type is JSON.
	return mime == "application/json" || (strings.HasPrefix(mime, "application/") && strings.HasSuffix(mime, "+json"))
}

func parseNotebook(nb NotebookDisk) Notebook {
	outNb := rejoinLines(nb)
	stripTransient(&nb)
	return outNb
}

func rejoinMimeBundle(data map[string]interface{}) map[string]string {
	// rejoinMimeBundle rejoins multi-line string fields in a mimebundle.
	outData := make(map[string]string)
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
					joined := strings.Join(toStringSlice(valueList), "\n")
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
		Metadata: nbDisk.Metadata,
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
					Ename:          output.Ename,
					Evalue:         output.Evalue,
					Traceback:      output.Traceback,
					Text:           strings.Join(output.Text, ""),
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
				Metadata:       cell.Metadata,
				Attachments:    attachmentData,
				Outputs:        outputData,
			})
	}
	return nb
}

// splitMimeBundle splits multi-line string fields in a mimebundle.
func splitMimeBundle(data map[string]string) map[string]interface{} {
	diskData := make(map[string]interface{})
	nonTextSplitMimes := map[string]bool{
		"application/javascript": false,
		"image/svg+xml":          false,
		"application/json":       false,
	}

	for key, value := range data {
		// if str, ok := value.(string); ok {
		if strings.HasPrefix(key, "text/") || nonTextSplitMimes[key] {
			splitValue := strings.SplitAfter(value, "\n")

			// Trim the last element to remove the trailing newline
			if len(splitValue) > 0 {
				splitValue[len(splitValue)-1] = strings.TrimSuffix(splitValue[len(splitValue)-1], "\n")
			}

			diskData[key] = splitValue
		} else {
			diskData[key] = value
		}
	}
	return diskData
}

// splitLines splits likely multi-line text into lists of strings.
func convertToNbDisk(nb Notebook) NotebookDisk {
	nbDisk := NotebookDisk{
		Cells:    []CellDisk{},
		Metadata: nb.Metadata,
	}
	for _, outCell := range nb.Cells {
		// Convert string slice to []interface{}
		sourceLines := strings.SplitAfter(outCell.Source, "\n")

		// Convert attachments map
		attachments := make(map[string]interface{})
		for k, v := range outCell.Attachments {
			attachments[k] = map[string]string{"data": v}
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
				Ename:          out.Ename,
				Evalue:         out.Evalue,
				Traceback:      out.Traceback,
			}
		}

		nbDisk.Cells = append(nbDisk.Cells, CellDisk{
			Source:         sourceLines,
			CellType:       outCell.CellType,
			ExecutionCount: outCell.ExecutionCount,
			Attachments:    attachments,
			Outputs:        outputsDisk,
			Metadata:       outCell.Metadata,
		})
	}

	return nbDisk

}

// stripTransient removes transient metadata from the notebook.
func stripTransient(nb *NotebookDisk) *NotebookDisk {
	delete(nb.Metadata, "orig_nbformat")
	delete(nb.Metadata, "orig_nbformat_minor")
	delete(nb.Metadata, "signature")
	for _, cell := range nb.Cells {
		delete(cell.Metadata, "trusted")
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
	Cells    []CellDisk             `json:"cells"`
	Metadata map[string]interface{} `json:"metadata"`
}

// Notebook struct that is rendered as json to outside world
type Notebook struct {
	Cells    []Cell                 `json:"cells"`
	Metadata map[string]interface{} `json:"metadata"`
}

// Cell struct for handling individual cells in a notebook
type CellDisk struct {
	Source         []string               `json:"source"`
	ExecutionCount int                    `json:"execution_count"`
	CellType       string                 `json:"cell_type"`
	Attachments    map[string]interface{} `json:"attachments"`
	Outputs        []OutputDisk           `json:"outputs"`
	Metadata       map[string]interface{} `json:"metadata"`
}

type Cell struct {
	Source         string                 `json:"source"`
	ExecutionCount int                    `json:"execution_count"`
	CellType       string                 `json:"cell_type"`
	Attachments    map[string]string      `json:"attachments"`
	Outputs        []Output               `json:"outputs"`
	Metadata       map[string]interface{} `json:"metadata"`
}

// Output struct for handling cell outputs
type OutputDisk struct {
	OutputType     string                 `json:"output_type"`
	ExecutionCount int                    `json:"execution_count"`
	Data           map[string]interface{} `json:"data"`
	Text           []string               `json:"text"`
	Metadata       map[string]interface{} `json:"metadata"`
	// in case of error traceback
	Ename     string   `json:"ename"`
	Evalue    string   `json:"evalue"`
	Traceback []string `json:"traceback"`
}

type Output struct {
	OutputType     string                 `json:"output_type"`
	ExecutionCount int                    `json:"execution_count"`
	Data           map[string]string      `json:"data"`
	Text           string                 `json:"text"`
	Metadata       map[string]interface{} `json:"metadata"`
	// in case of error traceback
	Ename     string   `json:"ename"`
	Evalue    string   `json:"evalue"`
	Traceback []string `json:"traceback"`
}
