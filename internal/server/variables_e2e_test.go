package server

import (
	"net/http"
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

	status, body = call(t, srv, http.MethodGet, "/api/kernels/"+created.Kernel.Id+"/variables/frame?offset=200&limit=100", nil)
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	page := decode[kernel.Preview](t, body)
	assert.Equal(t, 250, page.TotalRows)
	require.Len(t, page.Columns, 3)
	assert.Equal(t, kernel.Column{Name: "x", Dtype: "int64"}, page.Columns[0])
	assert.Equal(t, kernel.Column{Name: "y", Dtype: "float64"}, page.Columns[1])
	require.Len(t, page.Rows, 50)
	assert.Equal(t, "200", page.Index[0])
	assert.EqualValues(t, 200, page.Rows[0][0])
	assert.EqualValues(t, 100, page.Rows[0][1])
	missing, ok := page.Rows[0][2].(map[string]any)
	require.True(t, ok, "a missing value is marked as one: %v", page.Rows[0][2])
	assert.Contains(t, []any{"None", "NaN"}, missing["missing"])
	assert.Equal(t, "a", page.Rows[1][2])
}

func TestAPreviewRefusesWhatItCannotShow(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	created := startSession(t, srv, project, kernelName, "notes.ipynb")
	base := "/api/kernels/" + created.Kernel.Id + "/variables/"

	status, _ := call(t, srv, http.MethodGet, base+"os.system", nil)
	assert.Equal(t, http.StatusBadRequest, status, "only a plain name is accepted")

	status, body := call(t, srv, http.MethodGet, base+"never_defined", nil)
	assert.Equal(t, http.StatusUnprocessableEntity, status, "body was %s", body)
	assert.Contains(t, string(body), "not defined")

	status, _ = call(t, srv, http.MethodGet, base+"x?limit=0", nil)
	assert.Equal(t, http.StatusBadRequest, status)
}
