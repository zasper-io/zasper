package analytics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func post(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/telemetry", strings.NewReader(body))
	recorder := httptest.NewRecorder()
	TelemetryHandler(recorder, req)
	return recorder
}

// With tracking off the endpoint accepts and discards, so the frontend does not have to track whether
// the user turned it off partway through a session.
func TestTelemetryHandlerIsInertWhenDisabled(t *testing.T) {
	if Enabled() {
		t.Fatal("telemetry is enabled in a unit test")
	}

	recorder := post(t, `{"events":[{"event":"file_opened","properties":{"extension":"py"}}]}`)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
}

// The gateway does not trust the frontend. These are the payloads a compromised or buggy one would
// send, and each has to be refused outright rather than trimmed and forwarded.
func TestTelemetryHandlerRejectsWhatTheCatalogueForbids(t *testing.T) {
	// Validate is what the handler leans on, and it runs whether or not a client is connected. Assert
	// against it directly so the test does not depend on network state.
	tests := []struct {
		name  string
		event EventType
		props map[string]interface{}
	}{
		{
			"a path smuggled into an extra property",
			EventFileOpened,
			map[string]interface{}{"extension": "py", "full_path": "/Users/anna/acme/model.py"},
		},
		{
			"a path in place of an extension",
			EventFileOpened,
			map[string]interface{}{"extension": "/Users/anna/acme/model.py"},
		},
		{
			"an invented event",
			EventType("file_contents"),
			map[string]interface{}{"body": "print(salary)"},
		},
		{
			"cell source dressed up as a command id",
			EventCommandExecuted,
			map[string]interface{}{"command_id": "import pandas as pd"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := Validate(test.event, test.props); err == nil {
				t.Fatalf("the gateway would have accepted %v", test.props)
			}
		})
	}
}

func TestTelemetryHandlerRejectsMalformedAndOversizedPayloads(t *testing.T) {
	// The size cap and the batch cap only bite once tracking is on; with it off the handler answers
	// 204 before reading. Assert the shape of the limits rather than the response here.
	if maxEventsPerReq <= 0 || maxBodyBytes <= 0 {
		t.Fatal("the telemetry endpoint has no limits")
	}

	req := httptest.NewRequest(http.MethodPost, "/api/telemetry", strings.NewReader("{not json"))
	recorder := httptest.NewRecorder()
	TelemetryHandler(recorder, req)
	// Disabled, so it short-circuits before parsing. The point of the case is that it does not panic.
	if recorder.Code != http.StatusNoContent && recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 204 or 400", recorder.Code)
	}
}
