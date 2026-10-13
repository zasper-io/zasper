package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/models"
)

// One kernel per family, each speaking its own language. A family with nothing installed is skipped.
var kernelFamilies = []struct {
	name      string
	languages []string
	print     string // writes hi-42
	fail      string // ends in an error
	sleep     string // runs for a minute, or "" for a kernel that cannot be interrupted
}{
	{"python", []string{"python"},
		"print('hi-' + str(40 + 2))", "raise ValueError('boom')", "import time; time.sleep(60)"},
	{"r", []string{"r"},
		`cat("hi-", 40 + 2, "\n", sep = "")`, `stop("boom")`, "Sys.sleep(60)"},
	{"julia", []string{"julia"},
		`println("hi-", 40 + 2)`, `error("boom")`, "sleep(60)"},
	{"bash", []string{"bash"},
		"echo hi-$((40 + 2))", "(exit 3)", "sleep 60"},
	// Deno and xeus-cpp answer neither SIGINT nor interrupt_request: a signal ends them, under
	// jupyter_client as here.
	{"deno", []string{"typescript"},
		`console.log("hi-" + (40 + 2))`, `throw new Error("boom")`, ""},
	// gonb runs a cell as the body of main only under %%.
	{"go", []string{"go"},
		"%%\nfmt.Printf(\"hi-%d\\n\", 40+2)", "%%\npanic(\"boom\")", "%%\ntime.Sleep(60 * time.Second)"},
	{"ruby", []string{"ruby"},
		`puts "hi-#{40 + 2}"`, `raise "boom"`, "sleep 60"},
	{"scala", []string{"scala"},
		`println("hi-" + (40 + 2))`, `throw new Exception("boom")`, "Thread.sleep(60000)"},
	{"cpp", []string{"cpp", "c++", "c++17"},
		"#include <iostream>\nstd::cout << \"hi-\" << 40 + 2 << std::endl;", "undeclared_name;", ""},
}

/*
Every family of kernel runs a cell, reports an error, stops a running cell when interrupted, comes back
after a restart and is let go of when its notebook is closed.

A smoke test of the protocol rather than of any language: everything else here runs against ipykernel,
and these are the things a notebook in any other language needs before anything else works.
*/
func TestEveryKernelFamilyRunsAndStops(t *testing.T) {
	for _, family := range kernelFamilies {
		t.Run(family.name, func(t *testing.T) {
			kernelName := requireKernelOf(t, family.languages...)
			srv, project := testServer(t)

			created := startSession(t, srv, project, kernelName, "notes.ipynb")
			conn := kernelSocket(t, srv, created)

			// The first cell waits for the kernel to start, which for a JVM kernel is slow.
			status, output := runToIdle(t, conn, created.Id, family.print, 120*time.Second)
			assert.Equal(t, "ok", status)
			assert.Contains(t, output, "hi-42")

			status, _ = runToIdle(t, conn, created.Id, family.fail, 30*time.Second)
			assert.Equal(t, "error", status, "a failing cell was reported as %q", status)

			if family.sleep != "" {
				interruptARunningCell(t, srv, conn, created, family.sleep)

				// IRkernel aborts the first request after an interrupt that follows an error.
				status, output = runToIdle(t, conn, created.Id, family.print, 30*time.Second)
				if status == "aborted" {
					status, output = runToIdle(t, conn, created.Id, family.print, 30*time.Second)
				}
				assert.Equal(t, "ok", status, "the kernel did not survive the interrupt")
				assert.Contains(t, output, "hi-42")
			}

			// A restart is a new session on the same notebook, as the restart button does it.
			code, body := call(t, srv, http.MethodDelete, "/api/sessions/"+created.Id, nil)
			require.Equal(t, http.StatusOK, code, "body was %s", body)
			awaitClosed(t, conn, 15*time.Second)

			restarted := startSession(t, srv, project, kernelName, "notes.ipynb")
			assert.NotEqual(t, created.Kernel.Id, restarted.Kernel.Id)
			conn = kernelSocket(t, srv, restarted)
			status, output = runToIdle(t, conn, restarted.Id, family.print, 120*time.Second)
			assert.Equal(t, "ok", status, "the restarted kernel did not run")
			assert.Contains(t, output, "hi-42")

			code, body = call(t, srv, http.MethodDelete, "/api/sessions/"+restarted.Id, nil)
			require.Equal(t, http.StatusOK, code, "body was %s", body)
			awaitClosed(t, conn, 15*time.Second)

			code, body = call(t, srv, http.MethodGet, "/api/kernels", nil)
			require.Equal(t, http.StatusOK, code)
			assert.Empty(t, decode[[]models.KernelModel](t, body))
		})
	}
}

// interruptARunningCell runs code that would take a minute and interrupts it.
func interruptARunningCell(t *testing.T, srv *httptest.Server, conn *websocket.Conn, session models.SessionModel, code string) {
	t.Helper()

	msgId := executeOverSocket(t, conn, session.Id, code)
	awaitMessage(t, conn, msgId, "execute_input", 30*time.Second)
	// execute_input is published before the code starts. IRkernel exits on a SIGINT in between, so
	// give the cell time to be running, as a user's click would.
	time.Sleep(2 * time.Second)

	status, body := call(t, srv, http.MethodPost, "/api/kernels/"+session.Kernel.Id+"/interrupt", nil)
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	reply := awaitMessage(t, conn, msgId, "execute_reply", 20*time.Second)
	assert.NotEqual(t, "ok", reply["status"], "the interrupted cell ran to the end")
}

/*
runToIdle runs code and answers with the status of its execute_reply and the text it printed or
returned. It reads until both the reply and the kernel going idle have arrived: they travel on different
channels, so either can come first. A request the kernel aborted unseen has a reply and no status.
*/
func runToIdle(t *testing.T, conn *websocket.Conn, sessionId, code string, within time.Duration) (string, string) {
	t.Helper()

	msgId := executeOverSocket(t, conn, sessionId, code)
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(within)))

	var status string
	var output strings.Builder
	idle := false
	for status == "" || !idle && status != "aborted" {
		_, raw, err := conn.ReadMessage()
		require.NoError(t, err, "the cell never finished; it printed %q", output.String())

		var message struct {
			Header struct {
				MsgType string `json:"msg_type"`
			} `json:"header"`
			ParentHeader struct {
				MsgId string `json:"msg_id"`
			} `json:"parent_header"`
			Content struct {
				Status         string         `json:"status"`
				ExecutionState string         `json:"execution_state"`
				Text           string         `json:"text"`
				Data           map[string]any `json:"data"`
			} `json:"content"`
		}
		require.NoError(t, json.Unmarshal(raw, &message))
		if message.ParentHeader.MsgId != msgId {
			continue
		}

		switch message.Header.MsgType {
		case "execute_reply":
			status = message.Content.Status
		case "status":
			idle = message.Content.ExecutionState == "idle"
		case "stream":
			output.WriteString(message.Content.Text)
		case "execute_result", "display_data":
			if text, ok := message.Content.Data["text/plain"].(string); ok {
				output.WriteString(text)
			}
		}
	}
	return status, output.String()
}
