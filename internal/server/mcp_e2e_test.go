package server

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/mcpbridge"
	"github.com/zasper-io/zasper/internal/runtimeinfo"
)

// agent connects to the server's /mcp as an agent called claude-code would.
func agent(t *testing.T, url string) *mcp.ClientSession {
	t.Helper()

	client := mcp.NewClient(&mcp.Implementation{Name: "claude-code", Version: "test"}, nil)
	session, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: url + "/mcp"}, nil)
	require.NoError(t, err)
	t.Cleanup(func() { session.Close() })
	return session
}

// callTool calls a tool and answers its text, failing the test on a tool error.
func callTool(t *testing.T, session *mcp.ClientSession, name string, arguments map[string]any) string {
	t.Helper()

	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: arguments})
	require.NoError(t, err)
	var text strings.Builder
	for _, content := range result.Content {
		if typed, ok := content.(*mcp.TextContent); ok {
			text.WriteString(typed.Text)
		}
	}
	require.False(t, result.IsError, "%s failed: %s", name, text.String())
	return text.String()
}

func TestAnAgentReadsEditsAndRunsANotebookOverMCP(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	notebook := `{"cells": [{"cell_type": "code", "id": "c1", "metadata": {}, "source": "x = 21", "outputs": [], "execution_count": null}],
	 "metadata": {"kernelspec": {"name": "` + kernelName + `", "display_name": "Python"}}, "nbformat": 4, "nbformat_minor": 5}`
	require.NoError(t, os.WriteFile(filepath.Join(project, "drift.ipynb"), []byte(notebook), 0o644))
	session := agent(t, srv.URL)

	tools, err := session.ListTools(context.Background(), nil)
	require.NoError(t, err)
	var names []string
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
	}
	assert.Subset(t, names, []string{"list_notebooks", "read_notebook", "edit_notebook", "run_cell", "interrupt_kernel", "list_variables", "describe_dataframe"})

	assert.Contains(t, callTool(t, session, "list_notebooks", nil), "drift.ipynb (no kernel)")

	read := callTool(t, session, "read_notebook", map[string]any{"path": "drift.ipynb"})
	assert.Contains(t, read, "id c1 · code")
	hash := strings.TrimSpace(strings.SplitN(strings.SplitN(read, "hash: ", 2)[1], "\n", 2)[0])

	edited := callTool(t, session, "edit_notebook", map[string]any{
		"path": "drift.ipynb", "hash": hash,
		"ops": []map[string]any{{"op": "insert", "after": "c1", "cell_type": "code", "source": "print(x * 2)"}},
	})
	inserted := strings.TrimSpace(strings.SplitN(edited, "inserted cells: ", 2)[1])

	callTool(t, session, "run_cell", map[string]any{"path": "drift.ipynb", "cell_id": "c1"})
	ran := callTool(t, session, "run_cell", map[string]any{"path": "drift.ipynb", "cell_id": inserted})
	assert.Contains(t, ran, "42")

	assert.Contains(t, callTool(t, session, "list_variables", map[string]any{"path": "drift.ipynb"}), "x: int")
	assert.Contains(t, callTool(t, session, "list_notebooks", nil), "drift.ipynb (kernel "+kernelName)
}

func TestAnEditOverAChangeTheAgentHasNotSeenIsRefused(t *testing.T) {
	srv, project := testServer(t)
	require.NoError(t, os.WriteFile(filepath.Join(project, "drift.ipynb"),
		[]byte(`{"cells": [{"cell_type": "code", "id": "c1", "metadata": {}, "source": "x", "outputs": [], "execution_count": null}], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}`), 0o644))
	session := agent(t, srv.URL)

	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "edit_notebook", Arguments: map[string]any{
		"path": "drift.ipynb", "hash": "stale", "ops": []map[string]any{{"op": "edit", "id": "c1", "source": "y"}},
	}})

	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, result.Content[0].(*mcp.TextContent).Text, "changed after you read it")
}

func TestAnAgentOnStdioReachesTheToolsThroughZasperMCP(t *testing.T) {
	t.Parallel()
	srv, project, s := serverFor(t, true)
	require.NoError(t, os.WriteFile(filepath.Join(project, "drift.ipynb"),
		[]byte(`{"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}`), 0o644))

	bridge, err := mcpbridge.Connect(context.Background(),
		runtimeinfo.Info{URL: srv.URL, Token: s.app.AccessToken, Project: project}, http.DefaultClient)
	require.NoError(t, err)
	agentIn, bridgeIn := io.Pipe()
	bridgeOut, agentOut := io.Pipe()
	go bridge.Serve(context.Background(), agentIn, agentOut)
	answers := bufio.NewScanner(bridgeOut)
	send := func(line string) { _, err := bridgeIn.Write([]byte(line + "\n")); require.NoError(t, err) }
	answer := func() string { require.True(t, answers.Scan(), "the bridge answered nothing"); return answers.Text() }

	send(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"claude-code","version":"1"}}}`)
	assert.Contains(t, answer(), `"name":"zasper"`)
	send(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	send(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_notebooks","arguments":{}}}`)
	assert.Contains(t, answer(), "drift.ipynb (no kernel)")
	require.NoError(t, bridgeIn.Close())
}

func TestAnAgentRunsTheWholeNotebookLooksAtTheKernelAndRestartsIt(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	notebook := `{"cells": [
	 {"cell_type": "code", "id": "c1", "metadata": {}, "source": "x = 21", "outputs": [], "execution_count": null},
	 {"cell_type": "markdown", "id": "m1", "metadata": {}, "source": "# Notes"},
	 {"cell_type": "code", "id": "c2", "metadata": {}, "source": "print(x * 2)", "outputs": [], "execution_count": null}],
	 "metadata": {"kernelspec": {"name": "` + kernelName + `", "display_name": "Python"}}, "nbformat": 4, "nbformat_minor": 5}`
	path := filepath.Join(project, "drift.ipynb")
	require.NoError(t, os.WriteFile(path, []byte(notebook), 0o644))
	session := agent(t, srv.URL)

	assert.Contains(t, callTool(t, session, "list_kernelspecs", nil), kernelName+":")

	ranAll := callTool(t, session, "run_all", map[string]any{"path": "drift.ipynb"})
	assert.Contains(t, ranAll, "cell 1 (c1) [1]")
	assert.Contains(t, ranAll, "42")
	assert.NotContains(t, ranAll, "m1")

	// The last run's output is written into the notebook just after the tool answers.
	var before []byte
	require.Eventually(t, func() bool {
		before, _ = os.ReadFile(path)
		return strings.Contains(string(before), `"42\n"`)
	}, 10*time.Second, 50*time.Millisecond)
	assert.Contains(t, callTool(t, session, "run_code", map[string]any{"path": "drift.ipynb", "code": "print(type(x).__name__)"}), "int")
	after, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, string(before), string(after), "code run to inspect the kernel reached the notebook")

	assert.Contains(t, callTool(t, session, "restart_kernel", map[string]any{"path": "drift.ipynb"}), "Restarted")
	assert.NotContains(t, callTool(t, session, "list_variables", map[string]any{"path": "drift.ipynb"}), "x: int")
}
