package mcpserver

import (
	"encoding/base64"
	"fmt"
	"html"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// What one output may put in front of a model. A training log's end is what is read, so a long stream
// keeps its tail.
const (
	maxOutputText = 4000
	maxImages     = 4
)

var (
	ansiEscape = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)
	htmlTag    = regexp.MustCompile(`(?s)<[^>]*>`)
	blankLines = regexp.MustCompile(`\n{3,}`)
)

/*
renderOutputs turns a cell's nbformat outputs into what a model reads: text it can take in, and images as
image content for a model that sees them. A plot is sent as the picture, a table as its text, and a widget
is named rather than sent, since its state means nothing without the page that draws it.
*/
func renderOutputs(outputs []map[string]interface{}) (string, []mcp.Content) {
	var text strings.Builder
	var images []mcp.Content
	for _, output := range outputs {
		switch output["output_type"] {
		case "stream":
			text.WriteString(tail(clean(stringOf(output["text"]))))
		case "error":
			fmt.Fprintf(&text, "%s: %s\n", stringOf(output["ename"]), stringOf(output["evalue"]))
			if traceback, ok := output["traceback"].([]interface{}); ok {
				lines := make([]string, 0, len(traceback))
				for _, line := range traceback {
					lines = append(lines, clean(stringOf(line)))
				}
				text.WriteString(tail(strings.Join(lines, "\n")) + "\n")
			}
		case "execute_result", "display_data":
			data, _ := output["data"].(map[string]interface{})
			if png := stringOf(data["image/png"]); png != "" && len(images) < maxImages {
				if decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(png)); err == nil {
					images = append(images, &mcp.ImageContent{Data: decoded, MIMEType: "image/png"})
					text.WriteString("[image]\n")
					continue
				}
			}
			text.WriteString(tail(bundleText(data)) + "\n")
		}
	}
	return strings.TrimRight(text.String(), "\n"), images
}

// bundleText is the most readable text a mime bundle offers.
func bundleText(data map[string]interface{}) string {
	if _, ok := data["application/vnd.jupyter.widget-view+json"]; ok {
		return "[a widget, which only the notebook page can draw]"
	}
	for _, mime := range []string{"text/markdown", "text/plain", "text/latex"} {
		if text := stringOf(data[mime]); text != "" {
			return clean(text)
		}
	}
	if page := stringOf(data["text/html"]); page != "" {
		return strings.TrimSpace(blankLines.ReplaceAllString(html.UnescapeString(htmlTag.ReplaceAllString(page, " ")), "\n\n"))
	}
	for mime := range data {
		return fmt.Sprintf("[%s]", mime)
	}
	return ""
}

func clean(text string) string {
	return ansiEscape.ReplaceAllString(text, "")
}

func tail(text string) string {
	if len(text) <= maxOutputText {
		return text
	}
	start := len(text) - maxOutputText
	for start < len(text) && !utf8.RuneStart(text[start]) {
		start++
	}
	return fmt.Sprintf("[… %d bytes left out]\n%s", start, text[start:])
}

// stringOf reads a value nbformat may hold as a string or as a list of lines.
func stringOf(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []interface{}:
		var joined strings.Builder
		for _, line := range typed {
			joined.WriteString(stringOf(line))
		}
		return joined.String()
	default:
		return ""
	}
}

// outputsOf reads a cell's outputs as the maps renderOutputs takes.
func outputsOf(cell map[string]interface{}) []map[string]interface{} {
	raw, _ := cell["outputs"].([]interface{})
	outputs := make([]map[string]interface{}, 0, len(raw))
	for _, output := range raw {
		if typed, ok := output.(map[string]interface{}); ok {
			outputs = append(outputs, typed)
		}
	}
	return outputs
}
