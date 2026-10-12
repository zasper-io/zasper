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
		// Hash is the version the save replaces, as a read served it. Empty writes whatever is there.
		Hash string `json:"hash"`
	}

	SaveResult struct {
		Hash string `json:"hash"`
	}

	// NotebookOpsRequest changes a notebook's cells by id. Hash, as for a save, is the version the
	// operations were worked out against; Client names who asks, for open tabs to say so.
	NotebookOpsRequest struct {
		Path   string       `json:"path"`
		Hash   string       `json:"hash"`
		Client string       `json:"client"`
		Ops    []NotebookOp `json:"ops"`
	}

	NotebookOpsResult struct {
		Hash string `json:"hash"`
		// The id of each cell an insert made, in the order of the inserts.
		Inserted []string `json:"inserted"`
	}

	// SaveConflict answers a save whose Hash is no longer the file's, with the hash it has now.
	SaveConflict struct {
		Error   string `json:"error"`
		Message string `json:"message"`
		Hash    string `json:"hash"`
	}
)
