/*
Package mcpserver is Zasper as an MCP server: the notebooks and the kernels behind them, as tools any agent
can call. Files, search and git are left to the agent's own tools, which do them well; what only Zasper has
is a live kernel and outputs an agent can see. See docs/MCP.md.
*/
package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/kernelspec"
	"github.com/zasper-io/zasper/internal/nbformat"
	"github.com/zasper-io/zasper/internal/session"
)

// What a run is waited on for by default, and at most. Past it the run carries on, and its output reaches
// the notebook.
const (
	defaultRunWait = 60 * time.Second
	maxRunWait     = 10 * time.Minute
)

// Deps are the parts of the server the tools stand on.
type Deps struct {
	Content  *content.Handler
	Sessions *session.Sessions
	Kernels  *kernel.Kernels
	Specs    *kernelspec.Catalog
	// Nil when the project's code may run; refuses a run otherwise, as the rest of the server does.
	AllowRun func() error
	Version  string
}

type tools struct{ Deps }

// New answers the MCP server, with every tool on it.
func New(deps Deps) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "zasper", Version: deps.Version}, &mcp.ServerOptions{
		Instructions: "Zasper is the IDE the user has open. These tools read and change the notebooks in their " +
			"project and run cells in the notebook's live kernel; a notebook the user has open shows every change " +
			"and run as it happens, in the cell it is for. Cells are named by id: read a notebook before changing it.",
	})
	t := tools{deps}
	server.AddReceivingMiddleware(countToolCalls)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_notebooks",
		Description: "The notebooks in the project, and whether each has a kernel running.",
	}, t.listNotebooks)
	mcp.AddTool(server, &mcp.Tool{
		Name: "read_notebook",
		Description: "A notebook's cells, with their ids, sources and outputs. Plots come back as images. " +
			"Returns the notebook's hash, to pass to edit_notebook.",
	}, t.readNotebook)
	mcp.AddTool(server, &mcp.Tool{
		Name: "edit_notebook",
		Description: "Change a notebook's cells by id, in order, written once: insert (after a cell id, or at the " +
			"top with an empty after), edit, delete, move. Pass the hash read_notebook returned, so a change made " +
			"since is not written over. A cell the user is editing at the same time is shown to them to choose.",
	}, t.editNotebook)
	mcp.AddTool(server, &mcp.Tool{
		Name: "run_cell",
		Description: "Run a code cell in the notebook's kernel, starting the kernel the notebook names if none " +
			"is running, and return its outputs. The user sees it run in the cell. input() cannot be answered.",
	}, t.runCell)
	mcp.AddTool(server, &mcp.Tool{
		Name: "run_all",
		Description: "Run every code cell of the notebook in order, stopping at the first that fails, and return " +
			"each one's outputs.",
	}, t.runAll)
	mcp.AddTool(server, &mcp.Tool{
		Name: "run_code",
		Description: "Run code in the notebook's kernel to look at its state, and return the output. It goes in " +
			"no cell and is not saved; use it to inspect, and edit_notebook and run_cell to change the notebook.",
	}, t.runCode)
	mcp.AddTool(server, &mcp.Tool{
		Name: "restart_kernel",
		Description: "Restart the notebook's kernel with a fresh one of the same kind. Everything the kernel " +
			"holds is lost; the user's open notebook follows the new kernel.",
	}, t.restartKernel)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_kernelspecs",
		Description: "The kernels this project can start, by name, with their languages.",
	}, t.listKernelspecs)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "interrupt_kernel",
		Description: "Interrupt the notebook's kernel, stopping the cell it is running.",
	}, t.interruptKernel)
	mcp.AddTool(server, &mcp.Tool{
		Name: "list_variables",
		Description: "The variables in the notebook's running kernel, with their types and shapes. Python " +
			"kernels only.",
	}, t.listVariables)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "describe_dataframe",
		Description: "A dataframe or array in the notebook's kernel: its columns, their types and statistics, and its first rows.",
	}, t.describeDataframe)
	return server
}

// countToolCalls counts each tool an agent calls, by name and nothing else.
func countToolCalls(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
		if call, ok := req.(*mcp.CallToolRequest); ok && call.Params != nil {
			analytics.Track(analytics.EventMCPToolCalled, map[string]interface{}{"tool": analytics.MCPTool(call.Params.Name)})
		}
		return next(ctx, method, req)
	}
}

// Handler serves the MCP server over streamable HTTP, answering in plain JSON.
func Handler(server *mcp.Server) http.Handler {
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{
		JSONResponse: true,
	})
}

// clientOf is the name the agent gave when it connected, which open tabs show it by.
func clientOf(req *mcp.CallToolRequest) string {
	if req == nil || req.Session == nil {
		return ""
	}
	if params := req.Session.InitializeParams(); params != nil && params.ClientInfo != nil {
		return params.ClientInfo.Name
	}
	return ""
}

func textResult(text string, extra ...mcp.Content) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: append([]mcp.Content{&mcp.TextContent{Text: text}}, extra...)}
}

func failure(err error) *mcp.CallToolResult {
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}}}
}

type noInput struct{}

func (t tools) listNotebooks(_ context.Context, _ *mcp.CallToolRequest, _ noInput) (*mcp.CallToolResult, any, error) {
	paths, err := t.Content.Notebooks()
	if err != nil {
		return failure(err), nil, nil
	}
	if len(paths) == 0 {
		return textResult("The project has no notebooks."), nil, nil
	}
	var lines []string
	for _, path := range paths {
		state := "no kernel"
		if km, ok := t.Sessions.KernelFor(path); ok {
			_, executionState, _ := km.Status()
			state = fmt.Sprintf("kernel %s, %s", km.KernelName, executionState)
		}
		lines = append(lines, fmt.Sprintf("%s (%s)", path, state))
	}
	return textResult(strings.Join(lines, "\n")), nil, nil
}

type pathInput struct {
	Path string `json:"path" jsonschema:"the notebook, relative to the project"`
}

func (t tools) readNotebook(_ context.Context, _ *mcp.CallToolRequest, in pathInput) (*mcp.CallToolResult, any, error) {
	model, err := t.Content.Notebook(in.Path)
	if err != nil {
		return failure(err), nil, nil
	}
	doc, _ := model.Content.(nbformat.Document)
	var text strings.Builder
	fmt.Fprintf(&text, "%s\nhash: %s\n", in.Path, model.Hash)
	if _, minor := doc.Version(); minor < 5 {
		text.WriteString("This notebook is older than nbformat 4.5: its cells have no ids, so it can be read but not edited.\n")
	}
	var images []mcp.Content
	for i, cell := range doc.Cells() {
		id, _ := cell["id"].(string)
		kind, _ := cell["cell_type"].(string)
		fmt.Fprintf(&text, "\n--- cell %d · id %s · %s", i+1, id, kind)
		if count, ok := cell["execution_count"]; ok && count != nil {
			fmt.Fprintf(&text, " · [%v]", count)
		}
		fmt.Fprintf(&text, "\n%s\n", stringOf(cell["source"]))
		if outputs := outputsOf(cell); len(outputs) > 0 {
			rendered, pictures := renderOutputs(outputs)
			fmt.Fprintf(&text, "--- output\n%s\n", rendered)
			if room := maxImages - len(images); room > 0 {
				images = append(images, pictures[:min(room, len(pictures))]...)
			}
		}
	}
	return textResult(text.String(), images...), nil, nil
}

type editInput struct {
	Path string               `json:"path" jsonschema:"the notebook, relative to the project"`
	Hash string               `json:"hash,omitempty" jsonschema:"the hash read_notebook returned; the edit is refused if the notebook has changed since"`
	Ops  []content.NotebookOp `json:"ops" jsonschema:"the changes, carried out in order"`
}

func (t tools) editNotebook(_ context.Context, req *mcp.CallToolRequest, in editInput) (*mcp.CallToolResult, any, error) {
	result, err := t.Content.ApplyNotebookOps(in.Path, in.Hash, clientOf(req), in.Ops)
	var stale content.StaleError
	if errors.As(err, &stale) {
		return failure(fmt.Errorf("the notebook changed after you read it, so nothing was changed: read it again (it is now %s)", stale.Hash)), nil, nil
	}
	if err != nil {
		return failure(err), nil, nil
	}
	text := "hash: " + result.Hash
	if len(result.Inserted) > 0 {
		text += "\ninserted cells: " + strings.Join(result.Inserted, ", ")
	}
	return textResult(text), nil, nil
}

type runInput struct {
	Path    string `json:"path" jsonschema:"the notebook, relative to the project"`
	CellID  string `json:"cell_id" jsonschema:"the code cell to run"`
	Timeout int    `json:"timeout,omitempty" jsonschema:"seconds to wait for the run to finish; 60 when left out, 600 at most"`
}

func (t tools) runCell(ctx context.Context, req *mcp.CallToolRequest, in runInput) (*mcp.CallToolResult, any, error) {
	if t.AllowRun != nil {
		if err := t.AllowRun(); err != nil {
			return failure(err), nil, nil
		}
	}
	wait := t.waitFor(in.Timeout)
	ctx, cancel := context.WithTimeout(ctx, wait)
	defer cancel()

	run, err := t.Sessions.RunCell(ctx, in.Path, in.CellID, clientOf(req))
	if errors.Is(err, context.DeadlineExceeded) {
		return textResult(fmt.Sprintf("Still running after %s. Its output reaches the notebook as it comes; read_notebook shows it, and interrupt_kernel stops it.", wait)), nil, nil
	}
	if err != nil {
		return failure(err), nil, nil
	}
	rendered, images := renderOutputs(run.Outputs)
	text := fmt.Sprintf("[%v] done", run.ExecutionCount)
	if rendered != "" {
		text += "\n" + rendered
	}
	result := textResult(text, images...)
	for _, output := range run.Outputs {
		if output["output_type"] == "error" {
			result.IsError = true
		}
	}
	return result, nil, nil
}

func (t tools) kernelOf(path string) (*kernel.KernelManager, error) {
	km, ok := t.Sessions.KernelFor(path)
	if !ok {
		return nil, fmt.Errorf("%s has no kernel running: run a cell first", path)
	}
	return km, nil
}

func (t tools) interruptKernel(_ context.Context, _ *mcp.CallToolRequest, in pathInput) (*mcp.CallToolResult, any, error) {
	km, err := t.kernelOf(in.Path)
	if err != nil {
		return failure(err), nil, nil
	}
	if err := t.Kernels.Interrupt(km.KernelId); err != nil {
		return failure(err), nil, nil
	}
	return textResult("Interrupted."), nil, nil
}

func (t tools) listVariables(ctx context.Context, _ *mcp.CallToolRequest, in pathInput) (*mcp.CallToolResult, any, error) {
	km, err := t.kernelOf(in.Path)
	if err != nil {
		return failure(err), nil, nil
	}
	variables, err := km.Variables(ctx)
	if err != nil {
		return failure(err), nil, nil
	}
	if len(variables) == 0 {
		return textResult("No variables."), nil, nil
	}
	var lines []string
	for _, variable := range variables {
		line := fmt.Sprintf("%s: %s", variable.Name, variable.Type)
		if len(variable.Shape) > 0 {
			line += fmt.Sprintf(" %v", variable.Shape)
		}
		if variable.Summary != "" {
			line += " = " + variable.Summary
		}
		lines = append(lines, line)
	}
	return textResult(strings.Join(lines, "\n")), nil, nil
}

type frameInput struct {
	Path string `json:"path" jsonschema:"the notebook, relative to the project"`
	Name string `json:"name" jsonschema:"the variable holding the dataframe or array"`
}

func (t tools) describeDataframe(ctx context.Context, _ *mcp.CallToolRequest, in frameInput) (*mcp.CallToolResult, any, error) {
	km, err := t.kernelOf(in.Path)
	if err != nil {
		return failure(err), nil, nil
	}
	page, err := km.Rows(ctx, in.Name, kernel.Query{Limit: 10})
	if err != nil {
		return failure(err), nil, nil
	}
	if page.Error != "" {
		return failure(errors.New(page.Error)), nil, nil
	}
	var text strings.Builder
	fmt.Fprintf(&text, "%s: %d rows × %d columns\n", in.Name, page.TotalRows, page.TotalColumns)
	// A profile's columns are the page's, in the same order.
	if profile, err := km.Profile(ctx, in.Name); err == nil && profile.Error == "" {
		for i, column := range profile.Columns {
			if i < len(page.Columns) {
				fmt.Fprintf(&text, "%s\n", describeColumn(page.Columns[i], column))
			}
		}
	}
	text.WriteString("\nfirst rows:\n")
	names := make([]string, len(page.Columns))
	for i, column := range page.Columns {
		names[i] = column.Name
	}
	text.WriteString(strings.Join(names, "\t") + "\n")
	for _, row := range page.Rows {
		cells := make([]string, len(row))
		for i, value := range row {
			cells[i] = fmt.Sprint(value)
		}
		text.WriteString(strings.Join(cells, "\t") + "\n")
	}
	return textResult(text.String()), nil, nil
}

func describeColumn(column kernel.Column, profile kernel.ColumnProfile) string {
	line := fmt.Sprintf("  %s (%s): %d values", column.Name, column.Dtype, profile.Count)
	if profile.Missing > 0 {
		line += fmt.Sprintf(", %d missing", profile.Missing)
	}
	if profile.Distinct != nil {
		line += fmt.Sprintf(", %d distinct", *profile.Distinct)
	}
	if profile.Mean != nil {
		line += fmt.Sprintf(", mean %.4g", *profile.Mean)
	}
	if profile.Std != nil {
		line += fmt.Sprintf(", std %.4g", *profile.Std)
	}
	if profile.Min != nil || profile.Max != nil {
		line += fmt.Sprintf(", from %v to %v", profile.Min, profile.Max)
	}
	return line
}

func (t tools) waitFor(timeout int) time.Duration {
	if timeout <= 0 {
		return defaultRunWait
	}
	return min(time.Duration(timeout)*time.Second, maxRunWait)
}

type runAllInput struct {
	Path    string `json:"path" jsonschema:"the notebook, relative to the project"`
	Timeout int    `json:"timeout,omitempty" jsonschema:"seconds to wait for the whole notebook; 60 when left out, 600 at most"`
}

func (t tools) runAll(ctx context.Context, req *mcp.CallToolRequest, in runAllInput) (*mcp.CallToolResult, any, error) {
	if t.AllowRun != nil {
		if err := t.AllowRun(); err != nil {
			return failure(err), nil, nil
		}
	}
	model, err := t.Content.Notebook(in.Path)
	if err != nil {
		return failure(err), nil, nil
	}
	doc, _ := model.Content.(nbformat.Document)
	ctx, cancel := context.WithTimeout(ctx, t.waitFor(in.Timeout))
	defer cancel()

	var text strings.Builder
	var images []mcp.Content
	for i, cell := range doc.Cells() {
		id, _ := cell["id"].(string)
		if cell["cell_type"] != "code" || id == "" {
			continue
		}
		run, err := t.Sessions.RunCell(ctx, in.Path, id, clientOf(req))
		if errors.Is(err, context.DeadlineExceeded) {
			fmt.Fprintf(&text, "cell %d (%s): still running when the time ran out; the rest were not run\n", i+1, id)
			return textResult(text.String(), images...), nil, nil
		}
		if err != nil {
			return failure(err), nil, nil
		}
		rendered, pictures := renderOutputs(run.Outputs)
		fmt.Fprintf(&text, "--- cell %d (%s) [%v]\n%s\n", i+1, id, run.ExecutionCount, rendered)
		if room := maxImages - len(images); room > 0 {
			images = append(images, pictures[:min(room, len(pictures))]...)
		}
		for _, output := range run.Outputs {
			if output["output_type"] == "error" {
				text.WriteString("Stopped at this cell's error.\n")
				result := textResult(text.String(), images...)
				result.IsError = true
				return result, nil, nil
			}
		}
	}
	return textResult(strings.TrimRight(text.String(), "\n"), images...), nil, nil
}

type codeInput struct {
	Path    string `json:"path" jsonschema:"the notebook whose kernel runs it, relative to the project"`
	Code    string `json:"code" jsonschema:"the code to run"`
	Timeout int    `json:"timeout,omitempty" jsonschema:"seconds to wait; 60 when left out, 600 at most"`
}

func (t tools) runCode(ctx context.Context, req *mcp.CallToolRequest, in codeInput) (*mcp.CallToolResult, any, error) {
	if t.AllowRun != nil {
		if err := t.AllowRun(); err != nil {
			return failure(err), nil, nil
		}
	}
	km, err := t.kernelOf(in.Path)
	if err != nil {
		return failure(err), nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, t.waitFor(in.Timeout))
	defer cancel()
	run, err := km.Evaluate(ctx, clientOf(req), in.Code)
	if errors.Is(err, context.DeadlineExceeded) {
		return textResult("Still running when the time ran out; interrupt_kernel stops it."), nil, nil
	}
	if err != nil {
		return failure(err), nil, nil
	}
	rendered, images := renderOutputs(run.Outputs)
	if rendered == "" {
		rendered = "(no output)"
	}
	result := textResult(rendered, images...)
	for _, output := range run.Outputs {
		if output["output_type"] == "error" {
			result.IsError = true
		}
	}
	return result, nil, nil
}

func (t tools) restartKernel(_ context.Context, _ *mcp.CallToolRequest, in pathInput) (*mcp.CallToolResult, any, error) {
	if t.AllowRun != nil {
		if err := t.AllowRun(); err != nil {
			return failure(err), nil, nil
		}
	}
	session, err := t.Sessions.Restart(in.Path)
	if err != nil {
		return failure(err), nil, nil
	}
	return textResult(fmt.Sprintf("Restarted: a new %s kernel.", session.Kernel.Name)), nil, nil
}

func (t tools) listKernelspecs(_ context.Context, _ *mcp.CallToolRequest, _ noInput) (*mcp.CallToolResult, any, error) {
	if t.Specs == nil {
		return failure(errors.New("no kernelspecs are known")), nil, nil
	}
	specs := t.Specs.Specs()
	names := make([]string, 0, len(specs))
	for name := range specs {
		names = append(names, name)
	}
	slices.Sort(names)
	lines := make([]string, 0, len(names))
	for _, name := range names {
		spec := specs[name].Spec
		lines = append(lines, fmt.Sprintf("%s: %s (%s)", name, spec.DisplayName, spec.Language))
	}
	if len(lines) == 0 {
		return textResult("No kernels are installed."), nil, nil
	}
	return textResult(strings.Join(lines, "\n")), nil, nil
}
