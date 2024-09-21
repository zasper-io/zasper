package content

type (
	ContentRequestBody struct {
		Path string `json:"path"`
	}

	ContentPayload struct {
		Extension   string `json:"ext"`
		ContentType string `json:"type"`
	}

	RenameContentPayload struct {
		Path string `json:"path"`
	}

	ContentUpdateRequest struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		Format  string `json:"format"`
		Type    string `json:"type"`
	}
)
