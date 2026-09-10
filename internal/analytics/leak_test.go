package analytics

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/zasper-io/zasper/internal/core"
)

// Puts the package back the way an untouched process finds it, so a test that connects a client does
// not leave the ones after it looking at a live one.
func resetPackageState(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		mu.Lock()
		client = nil
		enabled = false
		forcedOff = false
		mu.Unlock()
	})

	mu.Lock()
	client = nil
	enabled = false
	forcedOff = false
	mu.Unlock()
}

/*
The acceptance test for the whole feature.

Everything else in this package checks a rule in isolation. This runs the real client against a
recorder standing in for PostHog and reads back the bytes that would have left the machine, then
asserts that none of them name a file, a folder, a project or a person. It is deliberately a string
search over the raw payload rather than a structured check: a leak that arrives in a field nobody
thought to look at is exactly the leak worth catching.
*/
func TestNothingIdentifyingReachesTheWire(t *testing.T) {
	var mu sync.Mutex
	var bodies []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var reader io.Reader = req.Body
		if req.Header.Get("Content-Encoding") == "gzip" {
			if gz, err := gzip.NewReader(req.Body); err == nil {
				reader = gz
			}
		}
		raw, _ := io.ReadAll(reader)

		mu.Lock()
		bodies = append(bodies, string(raw))
		mu.Unlock()

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":1}`))
	}))
	defer server.Close()

	// A throwaway HOME so the run writes its tracking id to a temporary config rather than the
	// developer's own.
	t.Setenv("HOME", t.TempDir())
	t.Setenv(endpointEnvVar, server.URL)
	resetPackageState(t)

	core.Zasper = core.SetUpZasper("9.9.9-test", ".", false)

	if err := SetUpPostHogClient(); err != nil {
		t.Fatalf("SetUpPostHogClient: %v", err)
	}
	if !Enabled() {
		t.Fatal("the client did not come up, so this test would pass for the wrong reason")
	}

	// The journeys, carrying the values a leak would carry.
	Track(EventServerStarted, nil)
	Track(EventNotebookOpened, nil)
	Track(EventFileOpened, map[string]interface{}{
		"extension": NormalizeExtension("/Users/anna/clients/acme/q3-forecast.ipynb"),
	})
	Track(EventFileOpened, map[string]interface{}{
		"extension": NormalizeExtension("patient-records.xlsx"),
	})
	Track(EventCodeCellExecuted, map[string]interface{}{
		"kernel_language": NormalizeLanguage("conda-env-anna-acme-py"),
	})
	Track(EventKernelStarted, map[string]interface{}{
		"kernel_language": NormalizeLanguage("python3"),
		"reused":          false,
	})
	Track(EventTerminalOpened, nil)
	Track(EventTerminalClosed, map[string]interface{}{"duration_bucket": Bucket(17)})
	Track(EventGitOperation, map[string]interface{}{"operation": "commit"})
	Track(EventCommandExecuted, map[string]interface{}{"command_id": "notebook:run-cell-and-advance"})
	Track(EventThemeChanged, map[string]interface{}{"theme_id": "teal-dark"})

	// Blocks until the queue has drained, which is what makes the assertions below meaningful.
	CloseClient()

	mu.Lock()
	captured := strings.Join(bodies, "\n")
	mu.Unlock()

	if captured == "" {
		t.Fatal("the recorder saw nothing, so this test proved nothing")
	}
	t.Logf("captured %d bytes across %d request(s)", len(captured), len(bodies))
	// `DUMP=1 go test -run TestNothingIdentifying ./internal/analytics/ -v` prints the payload, which is
	// how to answer "show me exactly what you send" without taking PRIVACY.md's word for it.
	if os.Getenv("DUMP") != "" {
		t.Log(captured)
	}

	lowered := strings.ToLower(captured)

	// Nothing from the paths, file names or environment names fed in above.
	for _, needle := range []string{
		"anna", "acme", "q3-forecast", "patient", "xlsx",
		"clients", "/users/", "conda", "forecast", "records",
	} {
		if strings.Contains(lowered, needle) {
			t.Errorf("the payload contains %q", needle)
		}
	}

	// Nor anything the machine knows about itself.
	for _, needle := range []string{
		core.Zasper.UserName,
		core.Zasper.HomeDir,
		core.Zasper.ProjectName,
	} {
		lowerNeedle := strings.ToLower(needle)
		// Two characters would match by accident; there is nothing to check in an empty one.
		if len(lowerNeedle) < 3 {
			continue
		}
		if strings.Contains(lowered, lowerNeedle) {
			t.Errorf("the payload contains the machine's own %q", needle)
		}
	}

	// And the privacy defaults really are on the wire, rather than merely configured.
	compact := strings.ReplaceAll(captured, " ", "")
	for _, needle := range []string{`"$ip":""`, `"$geoip_disable":true`, `"$process_person_profile":false`} {
		if !strings.Contains(compact, needle) {
			t.Errorf("the payload is missing %s", needle)
		}
	}
}

// Tracking off means no traffic at all — not an empty batch, and not one the server rejects.
func TestDisabledSessionMakesNoRequests(t *testing.T) {
	var mu sync.Mutex
	requests := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		mu.Lock()
		requests++
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	t.Setenv("HOME", t.TempDir())
	t.Setenv(endpointEnvVar, server.URL)
	resetPackageState(t)

	DisableForSession()

	if err := SetUpPostHogClient(); err != nil {
		t.Fatalf("SetUpPostHogClient: %v", err)
	}
	Track(EventServerStarted, nil)
	Track(EventFileOpened, map[string]interface{}{"extension": "py"})

	// A per-run switch outranks the settings toggle, which must not be able to undo it.
	SetEnabled(true)
	Track(EventFileOpened, map[string]interface{}{"extension": "py"})

	// Long enough for a batch to have gone out if one were going to.
	time.Sleep(500 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if requests != 0 {
		t.Fatalf("a disabled session made %d request(s)", requests)
	}
}
