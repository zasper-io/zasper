package content

import (
	"fmt"
	"strings"
)

func _isJSONMime(mime string) bool {
	// _isJSONMime checks if a MIME type is JSON.
	return mime == "application/json" || (strings.HasPrefix(mime, "application/") && strings.HasSuffix(mime, "+json"))
}

func parseNotebook(nb Notebook) OutNotebook {
	outNb := rejoinLines(nb)
	stripTransient(&nb)
	return outNb
}

func _rejoinMimeBundle(data map[string]interface{}) map[string]string {
	// _rejoinMimeBundle rejoins multi-line string fields in a mimebundle.
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

// rejoinLines rejoins multi-line text into strings.
func rejoinLines(nb Notebook) OutNotebook {
	outNb := OutNotebook{
		Metadata: nb.Metadata,
	}
	for _, cell := range nb.Cells {
		data := ""
		attachmentData := make(map[string]string)
		var outputData []OutOutput
		if cell.Source != nil {
			sourceList := toStringSlice(cell.Source)
			data = strings.Join(sourceList, "")
		}

		for _, attachment := range cell.Attachments {
			attachmentData = _rejoinMimeBundle(attachment)
		}

		if cell.CellType == "code" {
			for _, output := range cell.Outputs {
				x := OutOutput{
					OutputType:     output.OutputType,
					ExecutionCount: output.ExecutionCount,
					Metadata:       output.Metadata,
				}
				switch output.OutputType {
				case "execute_result", "display_data":
					x.Data = _rejoinMimeBundle(output.Data)
				case "stream":
					if output.Text != nil {
						text := toStringSlice(output.Text)
						x.Text = strings.Join(text, "")
					}
				}
				outputData = append(outputData, x)
			}
		}
		outNb.Cells = append(outNb.Cells,
			OutCell{Source: data,
				CellType:       cell.CellType,
				ExecutionCount: cell.ExecutionCount,
				Metadata:       cell.Metadata,
				Attachments:    attachmentData,
				Outputs:        outputData,
			})
	}
	return outNb
}

// _splitMimeBundle splits multi-line string fields in a mimebundle.
func _splitMimeBundle(data map[string]interface{}) map[string]interface{} {
	nonTextSplitMimes := map[string]bool{
		"application/javascript": true,
		"image/svg+xml":          true,
	}

	for key, value := range data {
		if str, ok := value.(string); ok {
			if strings.HasPrefix(key, "text/") || nonTextSplitMimes[key] {
				data[key] = strings.SplitAfter(str, "\n")
			}
		}
	}
	return data
}

// splitLines splits likely multi-line text into lists of strings.
// func splitLines(nb *Notebook) *Notebook {
// 	for _, cell := range nb.Cells {
// 		if source, ok := cell.Source.(string); ok {
// 			cell.Source = strings.SplitAfter(source, "\n")
// 		}

// 		for _, attachment := range cell.Attachments {
// 			_splitMimeBundle(attachment)
// 		}

// 		if cell.CellType == "code" {
// 			for _, output := range cell.Outputs {
// 				switch output.OutputType {
// 				case "execute_result", "display_data":
// 					_splitMimeBundle(output.Data)
// 				case "stream":
// 					if text, ok := output.Text.(string); ok {
// 						output.Text = strings.SplitAfter(text, "\n")
// 					}
// 				}
// 			}
// 		}
// 	}
// 	return nb
// }

// stripTransient removes transient metadata from the notebook.
func stripTransient(nb *Notebook) *Notebook {
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

// Notebook struct for handling notebook cells
type Notebook struct {
	Cells    []Cell                 `json:"cells"`
	Metadata map[string]interface{} `json:"metadata"`
}

// Notebook struct for handling notebook cells
type OutNotebook struct {
	Cells    []OutCell              `json:"cells"`
	Metadata map[string]interface{} `json:"metadata"`
}

// Cell struct for handling individual cells in a notebook
type Cell struct {
	Source         []interface{}                     `json:"source"`
	ExecutionCount int                               `json:"execution_count"`
	CellType       string                            `json:"cell_type"`
	Attachments    map[string]map[string]interface{} `json:"attachments"`
	Outputs        []Output                          `json:"outputs"`
	Metadata       map[string]interface{}            `json:"metadata"`
}

type OutCell struct {
	Source         string                 `json:"source"`
	ExecutionCount int                    `json:"execution_count"`
	CellType       string                 `json:"cell_type"`
	Attachments    map[string]string      `json:"attachments"`
	Outputs        []OutOutput            `json:"outputs"`
	Metadata       map[string]interface{} `json:"metadata"`
}

// Output struct for handling cell outputs
type Output struct {
	OutputType     string                 `json:"output_type"`
	ExecutionCount int                    `json:"execution_count"`
	Data           map[string]interface{} `json:"data"`
	Text           []interface{}          `json:"text"`
	Metadata       map[string]interface{} `json:"metadata"`
}

type OutOutput struct {
	OutputType     string                 `json:"output_type"`
	ExecutionCount int                    `json:"execution_count"`
	Data           map[string]string      `json:"data"`
	Text           string                 `json:"text"`
	Metadata       map[string]interface{} `json:"metadata"`
}
