package content

type ContentRequestBody struct {
	Path string `json:"path"`
}

type ContentPayload struct {
	Extension   string `json:"ext"`
	ContentType string `json:"type"`
}
