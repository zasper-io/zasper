package content

// Handler answers /api/contents and the project's watch socket.
type Handler struct {
	project Project
	watch   *projectWatch
	onMoved func(from, to string)
}

// NewHandler serves the files of project.
func NewHandler(project Project) *Handler {
	return &Handler{project: project, watch: newProjectWatch(project.root)}
}

// OnMoved registers what to call after a file or folder has moved, so whatever keys on a path can follow
// it: a running notebook's session, above all. It is set before the handler serves anything.
func (h *Handler) OnMoved(moved func(from, to string)) {
	h.onMoved = moved
}

func (h *Handler) moved(from, to string) {
	if from != to && h.onMoved != nil {
		h.onMoved(from, to)
	}
}
