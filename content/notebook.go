package content

import (
	"strings"
)

func _isJSONMime(mime string) bool {
	// _isJSONMime checks if a MIME type is JSON.
	return mime == "application/json" || (strings.HasPrefix(mime, "application/") && strings.HasSuffix(mime, "+json"))
}

func _rejoinMimeBundle(data map[string]interface{}) map[string]interface{} {
	// _rejoinMimeBundle rejoins multi-line string fields in a mimebundle.
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
					data[key] = joined
				}
			}
		}
	}
	return data
}

// rejoinLines rejoins multi-line text into strings.
func rejoinLines(nb *Notebook) {
	for _, cell := range nb.Cells {
		if cell.Source != nil {
			sourceList := cell.Source
			// if sourceList, ok := cell.Source.([]string); ok {
			cell.Source[0] = strings.Join(sourceList, "")
			// }
		}

		for _, attachment := range cell.Attachments {
			_rejoinMimeBundle(attachment)
		}

		if cell.CellType == "code" {
			for _, output := range cell.Outputs {
				switch output.OutputType {
				case "execute_result", "display_data":
					_rejoinMimeBundle(output.Data)
				case "stream":
					if text, ok := output.Text.([]string); ok {
						output.Text = strings.Join(text, "")
					}
				}
			}
		}
	}
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

// Cell struct for handling individual cells in a notebook
type Cell struct {
	Source         []string                          `json:"source"`
	ExecutionCount int                               `json:"execution_count"`
	CellType       string                            `json:"cell_type"`
	Attachments    map[string]map[string]interface{} `json:"attachments"`
	Outputs        []Output                          `json:"outputs"`
	Metadata       map[string]interface{}            `json:"metadata"`
}

// Output struct for handling cell outputs
type Output struct {
	OutputType string                 `json:"output_type"`
	Data       map[string]interface{} `json:"data"`
	Text       interface{}            `json:"text"`
}
