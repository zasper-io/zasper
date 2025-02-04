package content

type (
	ContentRequestBody struct {
		Path   string `json:"path"`
		Type   string `json:"type"`
		Hash   string `json:"hash"`
		Format string `json:"format"`
	}

	ContentPayload struct {
		ContentType string `json:"type"`
		ParentDir   string `json:"parent_dir"`
	}

	RenameContentPayload struct {
		ParentDir string `json:"parent_dir"`
		OldName   string `json:"old_name"`
		NewName   string `json:"new_name"`
	}

	ContentUpdateRequest struct {
		Path    string      `json:"path"`
		Content interface{} `json:"content"`
		Format  string      `json:"format"`
		Type    string      `json:"type"`
	}
)
