package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/kernel"
)

type kernelMessage struct {
	MsgType string
	Content map[string]any
}

// runOutputs collects what a run published, until its kernel goes idle.
func runOutputs(t *testing.T, conn *websocket.Conn, msgId string, within time.Duration) []kernelMessage {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(within)))
	var got []kernelMessage
	for {
		_, raw, err := conn.ReadMessage()
		require.NoError(t, err, "the run did not finish")
		var message struct {
			Header struct {
				MsgType string `json:"msg_type"`
			} `json:"header"`
			ParentHeader struct {
				MsgId string `json:"msg_id"`
			} `json:"parent_header"`
			Content map[string]any `json:"content"`
		}
		require.NoError(t, json.Unmarshal(raw, &message))
		if message.ParentHeader.MsgId != msgId {
			continue
		}
		if message.Header.MsgType == "status" && message.Content["execution_state"] == "idle" {
			return got
		}
		got = append(got, kernelMessage{message.Header.MsgType, message.Content})
	}
}

func of(messages []kernelMessage, kind string) []map[string]any {
	var found []map[string]any
	for _, m := range messages {
		if m.MsgType == kind {
			found = append(found, m.Content)
		}
	}
	return found
}

// A SQLite file in the project, a connection to it saved through the API, and a SQL cell run on it.
func TestASQLCellRunsOnAConnectionAndLeavesADataframe(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)

	require.NoError(t, os.MkdirAll(filepath.Join(project, "data"), 0o755))
	seed := "import sqlite3\nc = sqlite3.connect('data/local.db')\n" +
		"c.execute('CREATE TABLE orders (region TEXT, total REAL)')\n" +
		"c.executemany('INSERT INTO orders VALUES (?, ?)', [('EMEA', 1.5), ('AMER', 2.5), ('EMEA', 3.0)])\n" +
		"c.commit(); c.close()\n'seeded'"

	status, body := call(t, srv, http.MethodPut, "/api/connections",
		map[string]any{"name": "local", "type": "sqlite", "path": "data/local.db", "scope": "project"})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	assert.FileExists(t, filepath.Join(project, ".zasper", "connections.json"))

	created := startSession(t, srv, project, kernelName, "q.ipynb")
	conn, _, err := websocket.DefaultDialer.Dial(
		wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels")+"?session_id="+created.Id, nil)
	require.NoError(t, err)
	defer conn.Close()
	awaitExecuteResult(t, conn, executeOverSocket(t, conn, created.Id, seed), 60*time.Second)

	status, body = call(t, srv, http.MethodPost, "/api/connections/prepare",
		map[string]string{"kernel": created.Kernel.Id, "name": "local"})
	require.Equal(t, http.StatusOK, status, "body was %s", body)

	query := "%%zasper_sql local --out by_region --limit 1\n" +
		"SELECT region, sum(total) AS total FROM orders GROUP BY region ORDER BY region"
	outputs := runOutputs(t, conn, executeOverSocket(t, conn, created.Id, query), 60*time.Second)

	displays := of(outputs, "display_data")
	require.NotEmpty(t, displays, "the line saying where the rows came from")
	about := displays[0]["data"].(map[string]any)["application/vnd.zasper.sql+json"].(map[string]any)
	assert.Equal(t, "local", about["connection"])
	assert.Equal(t, "by_region", about["out"])
	assert.EqualValues(t, 1, about["rows"])
	assert.Equal(t, true, about["more"], "a limit of one row leaves the second")
	require.Len(t, of(outputs, "execute_result"), 1, "the dataframe, shown as the cell's result")

	result := awaitExecuteResult(t, conn, executeOverSocket(t, conn, created.Id, "by_region.to_dict('records')"), 30*time.Second)
	assert.Equal(t, "[{'region': 'AMER', 'total': 2.5}]", result["data"].(map[string]any)["text/plain"])

	// A file in the project is read again on every run, never answered from the cache: the notebook
	// itself changes it.
	write := "c = sqlite3.connect('data/local.db'); c.execute(\"INSERT INTO orders VALUES ('AMER', 10)\"); c.commit(); c.close()\n'written'"
	awaitExecuteResult(t, conn, executeOverSocket(t, conn, created.Id, write), 30*time.Second)
	outputs = runOutputs(t, conn, executeOverSocket(t, conn, created.Id, query), 60*time.Second)
	about = of(outputs, "display_data")[0]["data"].(map[string]any)["application/vnd.zasper.sql+json"].(map[string]any)
	assert.Equal(t, false, about["cached"])
	result = awaitExecuteResult(t, conn, executeOverSocket(t, conn, created.Id, "by_region.to_dict('records')"), 30*time.Second)
	assert.Equal(t, "[{'region': 'AMER', 'total': 12.5}]", result["data"].(map[string]any)["text/plain"])

	// A query the database refuses says so in its own words, without a Python traceback.
	outputs = runOutputs(t, conn, executeOverSocket(t, conn, created.Id, "%%zasper_sql local\nSELECT totl FROM orders"), 60*time.Second)
	errors := of(outputs, "error")
	require.Len(t, errors, 1)
	assert.Equal(t, "SqlError", errors[0]["ename"])
	assert.Contains(t, errors[0]["evalue"], "no such column: totl")

	// A connection whose driver this kernel lacks names the package, which the UI offers to install. This
	// kernel has no DuckDB; on one that has, the query simply runs.
	outputs = runOutputs(t, conn, executeOverSocket(t, conn, created.Id, "%%zasper_sql dataframes\nSELECT * FROM by_region"), 60*time.Second)
	if failed := of(outputs, "error"); len(failed) == 1 {
		assert.Regexp(t, `^duckdb is not installed in \S+`, failed[0]["evalue"])
	} else {
		require.Len(t, of(outputs, "execute_result"), 1)
	}

	// The Data panel, which asks a kernel of its own.
	status, body = call(t, srv, http.MethodPost, "/api/connections/schema", map[string]string{"name": "local"})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	schema := decode[kernel.SQLSchema](t, body)
	require.Len(t, schema.Schemas, 1)
	assert.Equal(t, []kernel.SQLTable{{Name: "orders", Kind: "table"}}, schema.Schemas[0].Tables)

	status, body = call(t, srv, http.MethodPost, "/api/connections/columns", map[string]string{"name": "local", "table": "orders"})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	assert.Equal(t, []kernel.SQLColumn{{Name: "region", Type: "TEXT"}, {Name: "total", Type: "REAL"}},
		decode[kernel.SQLColumns](t, body).Columns)

	status, body = call(t, srv, http.MethodPost, "/api/connections/test",
		map[string]any{"connection": map[string]any{"name": "local", "type": "sqlite", "path": "data/local.db"}})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	test := decode[kernel.SQLTest](t, body)
	assert.True(t, test.OK, "%+v", test)
	assert.Contains(t, test.Version, "SQLite")

	// The kernel's own dataframes, read through the notebook's kernel.
	status, body = call(t, srv, http.MethodPost, "/api/connections/schema",
		map[string]string{"kernel": created.Kernel.Id, "name": "dataframes"})
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	frames := decode[kernel.SQLSchema](t, body)
	require.Len(t, frames.Schemas, 1)
	assert.Equal(t, "by_region", frames.Schemas[0].Tables[0].Name)
}
