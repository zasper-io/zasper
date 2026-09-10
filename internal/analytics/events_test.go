package analytics

import (
	"strings"
	"testing"
)

// The rule the rest of this package exists to enforce: no property anywhere in the catalogue accepts
// an arbitrary string. If this fails, somebody has added a property that a file path fits in.
func TestNoPropertyAcceptsFreeText(t *testing.T) {
	// A name of the kind that must never reach PostHog, in the shapes a leak would take.
	leaks := []string{
		"/Users/anna/clients/acme/q3-forecast.ipynb",
		"q3-forecast-acme",
		"anna",
		"~/Desktop/patient-records.csv",
		"C:\\Users\\anna\\model.py",
		"print(salary)",
	}

	for event, properties := range eventRegistry {
		for name, spec := range properties {
			for _, leak := range leaks {
				if err := spec.validate(leak); err == nil {
					t.Errorf("%s.%s accepted %q; no property may take free text", event, name, leak)
				}
			}
		}
	}
}

func TestValidateRejectsUnknownEventsAndProperties(t *testing.T) {
	tests := []struct {
		name  string
		event EventType
		props map[string]interface{}
	}{
		{
			name:  "an event that is not in the catalogue",
			event: EventType("notebook_path_recorded"),
			props: nil,
		},
		{
			name:  "a property the event does not declare",
			event: EventFileOpened,
			props: map[string]interface{}{"extension": "py", "path": "/tmp/x.py"},
		},
		{
			name:  "an enum value outside the set",
			event: EventFileOpened,
			props: map[string]interface{}{"extension": "xlsx"},
		},
		{
			name:  "a bucket that was not produced by Bucket",
			event: EventServerShutdown,
			props: map[string]interface{}{"uptime_bucket": "37"},
		},
		{
			name:  "a bool property given a string",
			event: EventKernelStarted,
			props: map[string]interface{}{"kernel_language": "python", "reused": "yes"},
		},
		{
			name:  "a command id carrying a path",
			event: EventCommandExecuted,
			props: map[string]interface{}{"command_id": "notebook:/Users/anna/secret.ipynb"},
		},
		{
			name:  "a theme that is not one of ours",
			event: EventThemeChanged,
			props: map[string]interface{}{"theme_id": "anna-custom"},
		},
		{
			name:  "a git operation the panel does not offer",
			event: EventGitOperation,
			props: map[string]interface{}{"operation": "clone"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := Validate(test.event, test.props); err == nil {
				t.Fatalf("Validate accepted %s %v; want a rejection", test.event, test.props)
			}
		})
	}
}

func TestValidateAcceptsTheCatalogue(t *testing.T) {
	tests := []struct {
		event EventType
		props map[string]interface{}
	}{
		{EventServerStarted, nil},
		{EventServerShutdown, map[string]interface{}{"uptime_bucket": Bucket(42)}},
		{EventNotebookOpened, nil},
		{EventFileOpened, map[string]interface{}{"extension": "ipynb"}},
		{EventCodeCellExecuted, map[string]interface{}{"kernel_language": "python"}},
		{EventKernelStarted, map[string]interface{}{"kernel_language": "r", "reused": true}},
		{EventKernelStartFailed, map[string]interface{}{"kernel_language": "other"}},
		{EventTerminalOpened, nil},
		{EventTerminalClosed, map[string]interface{}{"duration_bucket": Bucket(0)}},
		{EventCommandExecuted, map[string]interface{}{"command_id": "notebook:run-cell-and-advance"}},
		{EventGitOperation, map[string]interface{}{"operation": "commit"}},
		{EventThemeChanged, map[string]interface{}{"theme_id": "teal-dark"}},
	}

	for _, test := range tests {
		t.Run(string(test.event), func(t *testing.T) {
			if err := Validate(test.event, test.props); err != nil {
				t.Fatalf("Validate rejected a catalogued event: %v", err)
			}
		})
	}
}

func TestBucket(t *testing.T) {
	tests := []struct {
		n    int
		want string
	}{
		{-1, "0"}, {0, "0"}, {1, "1"}, {2, "2-5"}, {5, "2-5"}, {6, "6-10"}, {10, "6-10"},
		{11, "11-25"}, {25, "11-25"}, {26, "26-50"}, {50, "26-50"}, {51, "51-100"},
		{100, "51-100"}, {101, "100+"}, {100000, "100+"},
	}

	for _, test := range tests {
		if got := Bucket(test.n); got != test.want {
			t.Errorf("Bucket(%d) = %q, want %q", test.n, got, test.want)
		}
	}
}

// Every label Bucket can produce has to be one Validate will take, or a count becomes unreportable.
func TestBucketOutputIsAlwaysValid(t *testing.T) {
	for _, n := range []int{-5, 0, 1, 3, 8, 20, 40, 75, 500} {
		props := map[string]interface{}{"uptime_bucket": Bucket(n)}
		if err := Validate(EventServerShutdown, props); err != nil {
			t.Errorf("Bucket(%d) produced a label Validate rejects: %v", n, err)
		}
	}
}

func TestNormalizeExtension(t *testing.T) {
	tests := []struct {
		name string
		want string
	}{
		{"analysis.ipynb", "ipynb"},
		{"/Users/anna/clients/acme/q3-forecast.ipynb", "ipynb"},
		{"Model.PY", "py"},
		{"data.csv", "csv"},
		{"patient-records.xlsx", "other"},
		{"README", "none"},
		{"Dockerfile", "dockerfile"},
		{"makefile", "makefile"},
		{".gitignore", "gitignore"},
		{".env", "env"},
		{"archive.tar.gz", "other"},
		{"", "none"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := NormalizeExtension(test.name)
			if got != test.want {
				t.Fatalf("NormalizeExtension(%q) = %q, want %q", test.name, got, test.want)
			}
			// Whatever it returns has to be reportable, or the mapping has a hole in it.
			if err := Validate(EventFileOpened, map[string]interface{}{"extension": got}); err != nil {
				t.Fatalf("NormalizeExtension(%q) produced an unreportable value: %v", test.name, err)
			}
		})
	}
}

func TestNormalizeLanguage(t *testing.T) {
	tests := []struct {
		name string
		want string
	}{
		{"python3", "python"},
		{"Python 3 (ipykernel)", "python"},
		{"conda-env-research-py", "python"},
		{"ir", "r"},
		{"R", "r"},
		{"julia-1.10", "julia"},
		{"gophernotes", "go"},
		{"go", "go"},
		{"xpython", "python"},
		{"evcxr_jupyter", "rust"},
		// The case that matters: an environment named after the person who made it.
		{"anna-clients-acme", "other"},
		{"", "other"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := NormalizeLanguage(test.name)
			if got != test.want {
				t.Fatalf("NormalizeLanguage(%q) = %q, want %q", test.name, got, test.want)
			}
			if err := Validate(EventCodeCellExecuted, map[string]interface{}{"kernel_language": got}); err != nil {
				t.Fatalf("NormalizeLanguage(%q) produced an unreportable value: %v", test.name, err)
			}
		})
	}
}

// A kernelspec name is user-controlled, so whatever it is, none of it may survive into a property.
func TestNormalizeLanguageNeverEchoesItsInput(t *testing.T) {
	secrets := []string{
		"anna-acme-q3",
		"/Users/anna/envs/patient-data",
		"conda-env-PATIENTS-py", // a recognised prefix, and still must not carry the rest
	}

	for _, secret := range secrets {
		got := NormalizeLanguage(secret)
		lowered := strings.ToLower(secret)
		if got != "other" && strings.Contains(lowered, got) && len(got) >= len(lowered) {
			t.Errorf("NormalizeLanguage(%q) = %q, which echoes its input", secret, got)
		}
		if strings.Contains(got, "anna") || strings.Contains(got, "acme") || strings.Contains(got, "patient") {
			t.Errorf("NormalizeLanguage(%q) = %q, which leaked part of the name", secret, got)
		}
	}
}

// Nothing is sent before SetUpPostHogClient has run, which is what makes --tracking=false mean no
// network rather than a dropped payload.
func TestTrackIsInertWhenDisabled(t *testing.T) {
	if Enabled() {
		t.Fatal("telemetry is enabled in a unit test; SetUpPostHogClient must not run here")
	}
	// The assertion is that this neither panics nor reaches a nil client.
	Track(EventServerStarted, nil)
	Track(EventFileOpened, map[string]interface{}{"extension": "py"})
}
