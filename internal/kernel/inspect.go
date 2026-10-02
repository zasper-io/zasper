package kernel

import (
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/go-zeromq/zmq4"
)

//go:embed inspect.py
var inspectSource []byte

// Loads inspect.py as its own module rather than running it in the user's namespace, so reading the
// variables adds none. Loaded on every request, which costs microseconds and means an upgraded server
// never talks to the helper an older one left in a kernel.
var inspectCode = fmt.Sprintf(
	"exec(__import__('base64').b64decode('%s').decode(), __import__('sys').modules.setdefault("+
		"'_zasper_inspect', __import__('types').ModuleType('_zasper_inspect')).__dict__)",
	base64.StdEncoding.EncodeToString(inspectSource))

// ErrNotInspectable is answered for a kernel whose language the helper is not written in.
var ErrNotInspectable = errors.New("variables can only be read from a Python kernel")

// Variable is one name in the kernel's namespace, described without sending its value.
type Variable struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Module  string `json:"module"`
	Kind    string `json:"kind"`
	Shape   []int  `json:"shape"`
	Size    *int   `json:"size"`
	Summary string `json:"summary"`
	// Whether Rows can show it as a table.
	Viewable bool `json:"viewable"`
}

type Column struct {
	Name  string `json:"name"`
	Dtype string `json:"dtype"`
	// number, datetime, bool, text or other: what a filter on it can compare.
	Kind string `json:"kind"`
}

// Page is some rows of a table-like variable, after the query's filters and sort.
type Page struct {
	Columns      []Column        `json:"columns"`
	TotalColumns int             `json:"total_columns"`
	Index        []string        `json:"index"`
	Rows         [][]interface{} `json:"rows"`
	TotalRows    int             `json:"total_rows"`
	MatchedRows  int             `json:"matched_rows"`
	Offset       int             `json:"offset"`
	// False for an array in a kernel without pandas, which can be paged but not sorted or filtered.
	Queryable bool   `json:"queryable"`
	Error     string `json:"error,omitempty"`
	// The output's table was let go by the kernel, or the kernel that drew it is not this one.
	Gone bool `json:"gone,omitempty"`
}

// Query is which rows of a variable to read. Columns are named by position, so a frame with duplicate
// or non-string column names can still be sorted and filtered.
type Query struct {
	Offset  int      `json:"offset"`
	Limit   int      `json:"limit"`
	Sort    *Sort    `json:"sort,omitempty"`
	Filters []Filter `json:"filters,omitempty"`
	// CSV only: which columns, by position, in this order. All of them when empty.
	Columns []int `json:"columns,omitempty"`
}

type Sort struct {
	Column     int  `json:"column"`
	Descending bool `json:"descending"`
}

type Filter struct {
	Column int    `json:"column"`
	Op     string `json:"op"`
	Value  string `json:"value"`
}

// FilterOps are the comparisons a filter can make.
var FilterOps = map[string]bool{
	"eq": true, "ne": true, "gt": true, "ge": true, "lt": true, "le": true,
	"contains": true, "not_contains": true, "starts_with": true, "missing": true, "present": true,
}

// Profile describes what is in each column of a table-like variable.
type Profile struct {
	Columns []ColumnProfile `json:"columns"`
	Error   string          `json:"error,omitempty"`
	Gone    bool            `json:"gone,omitempty"`
}

// Export is the rows a query leaves, as CSV.
type Export struct {
	CSV   string `json:"csv"`
	Error string `json:"error,omitempty"`
	Gone  bool   `json:"gone,omitempty"`
}

type ColumnProfile struct {
	Kind      string      `json:"kind"`
	Count     int         `json:"count"`
	Missing   int         `json:"missing"`
	Distinct  *int        `json:"distinct"`
	Min       interface{} `json:"min,omitempty"`
	Max       interface{} `json:"max,omitempty"`
	Mean      *float64    `json:"mean,omitempty"`
	Std       *float64    `json:"std,omitempty"`
	Histogram *Histogram  `json:"histogram,omitempty"`
	Top       []TopValue  `json:"top,omitempty"`
}

type Histogram struct {
	Counts []int      `json:"counts"`
	Edges  []*float64 `json:"edges"`
}

// ChartQuery is what to draw, and over which rows: columns are named by position, as in Query. Y is a
// list for every kind, though only a line draws more than one.
type ChartQuery struct {
	Kind    string   `json:"kind"`
	X       *int     `json:"x,omitempty"`
	Y       []int    `json:"y,omitempty"`
	Color   *int     `json:"color,omitempty"`
	Agg     string   `json:"agg,omitempty"`
	Filters []Filter `json:"filters,omitempty"`
}

// ChartKinds and ChartAggregates are what a ChartQuery can ask for.
var (
	ChartKinds      = map[string]bool{"histogram": true, "bar": true, "line": true, "scatter": true, "box": true}
	ChartAggregates = map[string]bool{"count": true, "sum": true, "mean": true, "median": true, "min": true, "max": true}
)

type TopValue struct {
	Value interface{} `json:"value"`
	Count int         `json:"count"`
}

// Variables lists the user's names in the kernel. It waits behind a running cell, as any request to a
// kernel does, for as long as ctx allows.
func (km *KernelManager) Variables(ctx context.Context) ([]Variable, error) {
	variables := []Variable{}
	err := km.inspect(ctx, "__import__('_zasper_inspect').variables()", &variables)
	return variables, err
}

// Rows reads the rows query asks for from the variable called name, which must already be a Python
// identifier. Both are passed as JSON strings, which Python reads as the same strings.
func (km *KernelManager) Rows(ctx context.Context, name string, query Query) (Page, error) {
	encoded, err := json.Marshal(query)
	if err != nil {
		return Page{}, err
	}
	var page Page
	err = km.inspect(ctx, fmt.Sprintf("__import__('_zasper_inspect').rows(%s, %s)", pyString(name), pyString(string(encoded))), &page)
	return page, err
}

// Profile summarises each column of the variable called name.
func (km *KernelManager) Profile(ctx context.Context, name string) (Profile, error) {
	var profile Profile
	err := km.inspect(ctx, fmt.Sprintf("__import__('_zasper_inspect').profile(%s)", pyString(name)), &profile)
	return profile, err
}

// CSV exports the rows a query leaves, up to query.Limit of them.
func (km *KernelManager) CSV(ctx context.Context, name string, query Query) (Export, error) {
	encoded, err := json.Marshal(query)
	if err != nil {
		return Export{}, err
	}
	var export Export
	err = km.inspect(ctx, fmt.Sprintf("__import__('_zasper_inspect').csv(%s, %s)", pyString(name), pyString(string(encoded))), &export)
	return export, err
}

// Chart answers what a chart of the variable called name draws: a few hundred numbers counted in the
// kernel, never its rows. The answer's shape depends on the kind, so it is passed on as the kernel wrote
// it, with what was wrong taken out.
func (km *KernelManager) Chart(ctx context.Context, name string, query ChartQuery) (json.RawMessage, Answered, error) {
	encoded, err := json.Marshal(query)
	if err != nil {
		return nil, Answered{}, err
	}
	var answer json.RawMessage
	err = km.inspect(ctx, fmt.Sprintf("__import__('_zasper_inspect').chart(%s, %s)", pyString(name), pyString(string(encoded))), &answer)
	if err != nil {
		return nil, Answered{}, err
	}
	var problem Answered
	err = json.Unmarshal(answer, &problem)
	return answer, problem, err
}

// Answered is the part of any answer that says the kernel could not give one.
type Answered struct {
	Error string `json:"error,omitempty"`
	Gone  bool   `json:"gone,omitempty"`
}

// LoadHelper loads the inspector into a Python kernel, which also installs the formatter that lets a
// cell's DataFrame output page, sort and filter. Run once a kernel first answers, so the first cell's
// output already has it.
func (km *KernelManager) LoadHelper(ctx context.Context) error {
	var loaded bool
	return km.inspect(ctx, "__import__('_zasper_inspect')._encode(True)", &loaded)
}

// pyString quotes text as a JSON string, which is also a Python string literal for the same text.
func pyString(text string) string {
	quoted, _ := json.Marshal(text)
	return string(quoted)
}

/*
inspect evaluates expression in the kernel through `user_expressions`, on a shell socket of its own and
with `silent` set: nothing is published as output, the execution count does not move, and nothing goes
into the history. The expression answers base64 JSON, whose repr is that string in quotes.
*/
func (km *KernelManager) inspect(ctx context.Context, expression string, into interface{}) error {
	if !strings.EqualFold(km.Spec.Language, "python") {
		return ErrNotInspectable
	}

	shell := km.ConnectionInfo.ConnectShell(ctx, zmq4.SocketIdentity("inspect-"+newID()))
	defer shell.Close()

	request := km.Session.MessageFromString("execute_request")
	request.Content = map[string]interface{}{
		"code":             inspectCode,
		"silent":           true,
		"store_history":    false,
		"user_expressions": map[string]string{"answer": expression},
		"allow_stdin":      false,
		"stop_on_error":    false,
	}
	if err := km.Session.send(shell, request); err != nil {
		return err
	}

	replies := make(chan *Message, 1)
	failed := make(chan error, 1)
	go func() {
		for {
			zmsg, err := shell.Recv()
			if err != nil {
				failed <- err
				return
			}
			reply, ok := km.Session.decode(zmsg, "shell")
			if ok && reply.ParentHeader.MsgID == request.Header.MsgID && reply.Header.MsgType == "execute_reply" {
				replies <- reply
				return
			}
		}
	}()

	select {
	case reply := <-replies:
		return decodeAnswer(reply, into)
	case err := <-failed:
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func decodeAnswer(reply *Message, into interface{}) error {
	content, _ := reply.Content.(map[string]interface{})
	if content["status"] != "ok" {
		return fmt.Errorf("the kernel could not run the inspector: %v: %v", content["ename"], content["evalue"])
	}
	expressions, _ := content["user_expressions"].(map[string]interface{})
	answer, _ := expressions["answer"].(map[string]interface{})
	if answer["status"] != "ok" {
		return fmt.Errorf("the kernel could not read its variables: %v: %v", answer["ename"], answer["evalue"])
	}
	data, _ := answer["data"].(map[string]interface{})
	text, _ := data["text/plain"].(string)

	encoded := strings.Trim(text, `'"`)
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return fmt.Errorf("the inspector's answer was not base64: %w", err)
	}
	return json.Unmarshal(decoded, into)
}
