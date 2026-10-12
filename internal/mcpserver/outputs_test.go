package mcpserver

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAPlotIsSentAsAnImageAndATableAsText(t *testing.T) {
	png := []byte("\x89PNG fake")
	text, images := renderOutputs([]map[string]interface{}{
		{"output_type": "display_data", "data": map[string]interface{}{
			"image/png": base64.StdEncoding.EncodeToString(png), "text/plain": "<Figure>",
		}},
		{"output_type": "execute_result", "data": map[string]interface{}{
			"text/html": "<table><tr><th>a</th></tr><tr><td>1&amp;2</td></tr></table>",
		}},
	})

	require.Len(t, images, 1)
	assert.Equal(t, png, images[0].(*mcp.ImageContent).Data)
	assert.Contains(t, text, "[image]")
	assert.Contains(t, text, "1&2")
	assert.NotContains(t, text, "<td>")
}

func TestPlainTextIsPreferredToHTML(t *testing.T) {
	text, _ := renderOutputs([]map[string]interface{}{{"output_type": "execute_result", "data": map[string]interface{}{
		"text/plain": "   a\n0  1", "text/html": "<table></table>",
	}}})

	assert.Equal(t, "   a\n0  1", text)
}

func TestALongStreamKeepsItsEnd(t *testing.T) {
	log := strings.Repeat("epoch\n", 2000) + "loss 0.01\n"

	text, _ := renderOutputs([]map[string]interface{}{{"output_type": "stream", "name": "stdout", "text": log}})

	assert.True(t, strings.HasSuffix(text, "loss 0.01"))
	assert.Contains(t, text, "bytes left out")
	assert.Less(t, len(text), maxOutputText+100)
}

func TestAnErrorIsItsNameMessageAndTracebackWithoutColour(t *testing.T) {
	text, _ := renderOutputs([]map[string]interface{}{{"output_type": "error", "ename": "ValueError", "evalue": "bad",
		"traceback": []interface{}{"\x1b[0;31mValueError\x1b[0m: bad"}}})

	assert.Contains(t, text, "ValueError: bad")
	assert.NotContains(t, text, "\x1b[")
}

func TestAWidgetIsNamedRatherThanSent(t *testing.T) {
	text, _ := renderOutputs([]map[string]interface{}{{"output_type": "display_data", "data": map[string]interface{}{
		"application/vnd.jupyter.widget-view+json": map[string]interface{}{"model_id": "x"}, "text/plain": "IntSlider()",
	}}})

	assert.Contains(t, text, "widget")
}
