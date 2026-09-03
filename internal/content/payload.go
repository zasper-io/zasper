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

	// MovePayload carries whole project-relative paths, so one endpoint covers a rename, a drag
	// between folders and a cut-and-paste.
	MovePayload struct {
		From string `json:"from"`
		To   string `json:"to"`
	}

	// CopyPayload names only the destination folder: the server picks a free name and answers with
	// it, so duplicating in place is a copy whose ToDir is where the original already is.
	CopyPayload struct {
		From  string `json:"from"`
		ToDir string `json:"to_dir"`
	}

	ContentUpdateRequest struct {
		Path    string      `json:"path"`
		Content interface{} `json:"content"`
		Format  string      `json:"format"`
		Type    string      `json:"type"`
	}
)
