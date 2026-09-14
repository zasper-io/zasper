package content

import (
	"net/http"
	"strconv"

	"github.com/editorconfig/editorconfig-core-go/v2"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/httpx"
)

// EditorConfig is what a project's .editorconfig files say about one file: only the properties they set.
type EditorConfig struct {
	// "space" or "tab".
	IndentStyle string `json:"indent_style,omitempty"`
	IndentSize  int    `json:"indent_size,omitempty"`
	TabWidth    int    `json:"tab_width,omitempty"`
	// "lf", "crlf" or "cr".
	EndOfLine              string `json:"end_of_line,omitempty"`
	Charset                string `json:"charset,omitempty"`
	TrimTrailingWhitespace *bool  `json:"trim_trailing_whitespace,omitempty"`
	InsertFinalNewline     *bool  `json:"insert_final_newline,omitempty"`
}

func editorConfigFrom(definition *editorconfig.Definition) EditorConfig {
	resolved := EditorConfig{
		IndentStyle:            definition.IndentStyle,
		TabWidth:               definition.TabWidth,
		EndOfLine:              definition.EndOfLine,
		Charset:                definition.Charset,
		TrimTrailingWhitespace: definition.TrimTrailingWhitespace,
		InsertFinalNewline:     definition.InsertFinalNewline,
	}
	// indent_size is a number, or "tab" for the tab's width.
	if size, err := strconv.Atoi(definition.IndentSize); err == nil && size > 0 {
		resolved.IndentSize = size
	} else if definition.IndentSize == "tab" {
		resolved.IndentSize = definition.TabWidth
	}
	return resolved
}

/*
EditorConfig answers the .editorconfig properties for the file at `path`. The folders above the project
are read too, up to a file saying `root = true`, as every other editor reads them. A file that cannot be
parsed gives an empty answer rather than an error: a broken .editorconfig must not stop a file opening.
*/
func (h *Handler) EditorConfig(w http.ResponseWriter, req *http.Request) {
	path := req.URL.Query().Get("path")
	osPath := h.project.SafePath(path)
	if path == "" || osPath == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "Invalid path")
		return
	}

	definition, err := editorconfig.GetDefinitionForFilename(osPath)
	if err != nil {
		log.Debug().Err(err).Str("path", path).Msg("could not read the .editorconfig for a file")
		httpx.SendJSON(w, http.StatusOK, EditorConfig{})
		return
	}
	httpx.SendJSON(w, http.StatusOK, editorConfigFrom(definition))
}
