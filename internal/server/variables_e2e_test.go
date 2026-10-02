package server

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/kernel"
)

const variablesCell = `
answer = 42
names = ["a", "b", "c"]
def helper(): pass
import json
_private = 1
try:
    import pandas as pd
    frame = pd.DataFrame({"x": range(250), "y": [i / 2 for i in range(250)], "note": [None, "a"] * 125})
except ImportError:
    pass
"done"`

func TestTheVariablesInAKernelAreListedAndATableIsPaged(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	created := startSession(t, srv, project, kernelName, "notes.ipynb")

	conn, _, err := websocket.DefaultDialer.Dial(
		wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels")+"?session_id="+created.Id, nil)
	require.NoError(t, err)
	defer conn.Close()
	msgId := executeOverSocket(t, conn, created.Id, variablesCell)
	awaitExecuteResult(t, conn, msgId, 60*time.Second)

	status, body := call(t, srv, http.MethodGet, "/api/kernels/"+created.Kernel.Id+"/variables", nil)
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	listed := map[string]kernel.Variable{}
	for _, variable := range decode[[]kernel.Variable](t, body) {
		listed[variable.Name] = variable
	}

	assert.Equal(t, "int", listed["answer"].Type)
	assert.Equal(t, "42", listed["answer"].Summary)
	require.NotNil(t, listed["names"].Size)
	assert.Equal(t, 3, *listed["names"].Size)
	for _, absent := range []string{"helper", "json", "_private", "In", "Out", "get_ipython", "_zasper_inspect"} {
		assert.NotContains(t, listed, absent)
	}

	// Silent: the next run is still the second.
	msgId = executeOverSocket(t, conn, created.Id, "1")
	assert.EqualValues(t, 2, awaitExecuteResult(t, conn, msgId, 30*time.Second)["execution_count"])

	frame, ok := listed["frame"]
	if !ok {
		t.Log("the kernel has no pandas; the table half is not exercised")
		return
	}
	assert.Equal(t, "dataframe", frame.Kind)
	assert.Equal(t, []int{250, 3}, frame.Shape)
	assert.Equal(t, "x, y, note", frame.Summary)
	assert.True(t, frame.Viewable)

	rows := "/api/kernels/" + created.Kernel.Id + "/variables/frame/rows"
	status, body = call(t, srv, http.MethodPost, rows, kernel.Query{Offset: 200, Limit: 100})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	page := decode[kernel.Page](t, body)
	assert.Equal(t, 250, page.TotalRows)
	assert.Equal(t, 250, page.MatchedRows)
	assert.True(t, page.Queryable)
	require.Len(t, page.Columns, 3)
	assert.Equal(t, kernel.Column{Name: "x", Dtype: "int64", Kind: "number"}, page.Columns[0])
	assert.Equal(t, "number", page.Columns[1].Kind)
	assert.Equal(t, "text", page.Columns[2].Kind)
	require.Len(t, page.Rows, 50)
	assert.Equal(t, "200", page.Index[0])
	assert.EqualValues(t, 200, page.Rows[0][0])
	assert.EqualValues(t, 100, page.Rows[0][1])
	missing, ok := page.Rows[0][2].(map[string]any)
	require.True(t, ok, "a missing value is marked as one: %v", page.Rows[0][2])
	assert.Contains(t, []any{"None", "NaN"}, missing["missing"])
	assert.Equal(t, "a", page.Rows[1][2])

	// Filtered and sorted in the kernel: x of at least 240 with a note, largest first.
	status, body = call(t, srv, http.MethodPost, rows, kernel.Query{
		Limit:   100,
		Sort:    &kernel.Sort{Column: 0, Descending: true},
		Filters: []kernel.Filter{{Column: 0, Op: "ge", Value: "240"}, {Column: 2, Op: "present"}},
	})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	page = decode[kernel.Page](t, body)
	assert.Equal(t, 5, page.MatchedRows)
	assert.Equal(t, []string{"249", "247", "245", "243", "241"}, page.Index)

	status, body = call(t, srv, http.MethodPost, rows, kernel.Query{
		Limit: 10, Filters: []kernel.Filter{{Column: 0, Op: "gt", Value: "lots"}},
	})
	assert.Equal(t, http.StatusUnprocessableEntity, status)
	assert.Contains(t, string(body), "cannot be compared")

	status, body = call(t, srv, http.MethodGet, "/api/kernels/"+created.Kernel.Id+"/variables/frame/profile", nil)
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	profile := decode[kernel.Profile](t, body)
	require.Len(t, profile.Columns, 3)
	x := profile.Columns[0]
	assert.Equal(t, "number", x.Kind)
	assert.EqualValues(t, 0, x.Min)
	assert.EqualValues(t, 249, x.Max)
	require.NotNil(t, x.Histogram)
	sum := 0
	for _, count := range x.Histogram.Counts {
		sum += count
	}
	assert.Equal(t, 250, sum)
	note := profile.Columns[2]
	assert.Equal(t, 125, note.Missing)
	require.NotEmpty(t, note.Top)
	assert.Equal(t, "a", note.Top[0].Value)
	assert.Equal(t, 125, note.Top[0].Count)
}

func TestReadingRowsRefusesWhatItCannotShow(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	created := startSession(t, srv, project, kernelName, "notes.ipynb")
	base := "/api/kernels/" + created.Kernel.Id + "/variables/"
	page := kernel.Query{Limit: 10}

	status, _ := call(t, srv, http.MethodPost, base+"os.system/rows", page)
	assert.Equal(t, http.StatusBadRequest, status, "only a plain name is accepted")

	status, body := call(t, srv, http.MethodPost, base+"never_defined/rows", page)
	assert.Equal(t, http.StatusUnprocessableEntity, status, "body was %s", body)
	assert.Contains(t, string(body), "not defined")

	status, _ = call(t, srv, http.MethodPost, base+"x/rows", kernel.Query{Limit: 0})
	assert.Equal(t, http.StatusBadRequest, status)

	status, _ = call(t, srv, http.MethodPost, base+"x/rows", kernel.Query{Limit: 10, Filters: []kernel.Filter{{Op: "__import__"}}})
	assert.Equal(t, http.StatusBadRequest, status, "only known comparisons reach the kernel")
}

func TestACellsDataFrameOutputCanBePagedByItsOwnId(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	created := startSession(t, srv, project, kernelName, "notes.ipynb")

	// Reading the variables loads the helper, so the formatter is in place before the cell runs.
	status, body := call(t, srv, http.MethodGet, "/api/kernels/"+created.Kernel.Id+"/variables", nil)
	require.Equal(t, http.StatusOK, status, "body was %s", body)

	conn, _, err := websocket.DefaultDialer.Dial(
		wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels")+"?session_id="+created.Id, nil)
	require.NoError(t, err)
	defer conn.Close()
	msgId := executeOverSocket(t, conn, created.Id, "try:\n    import pandas as pd\nexcept ImportError:\n    pd = None\npd and pd.DataFrame({'x': range(30), 'y': list('ab') * 15}).sort_values('x', ascending=False)")
	result := awaitExecuteResult(t, conn, msgId, 60*time.Second)
	data, ok := result["data"].(map[string]any)
	require.True(t, ok, "the result carried no data: %v", result)
	if data["text/plain"] == "None" {
		t.Skip("the kernel has no pandas")
	}

	table, ok := data["application/vnd.zasper.dataframe+json"].(map[string]any)
	require.True(t, ok, "the output carries its table: %v", data)
	assert.Contains(t, data, "text/html", "and pandas' own HTML beside it")
	assert.EqualValues(t, 30, table["rows"])
	ref := "@" + table["id"].(string)
	base := "/api/kernels/" + created.Kernel.Id + "/variables/" + ref

	status, body = call(t, srv, http.MethodPost, base+"/rows", kernel.Query{
		Limit: 3, Filters: []kernel.Filter{{Column: 1, Op: "eq", Value: "a"}},
	})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	page := decode[kernel.Page](t, body)
	assert.Equal(t, 15, page.MatchedRows)
	assert.Equal(t, []string{"28", "26", "24"}, page.Index, "the frame as the cell printed it, sorted descending")

	status, body = call(t, srv, http.MethodPost, base+"/csv", kernel.Query{
		Sort: &kernel.Sort{Column: 0}, Filters: []kernel.Filter{{Column: 0, Op: "lt", Value: "2"}},
	})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	assert.Equal(t, ",x,y\n0,0,a\n1,1,b\n", string(body))

	status, _ = call(t, srv, http.MethodPost, "/api/kernels/"+created.Kernel.Id+"/variables/@"+strings.Repeat("0", 32)+"/rows", kernel.Query{Limit: 3})
	assert.Equal(t, http.StatusGone, status, "a table the kernel does not hold")
}
