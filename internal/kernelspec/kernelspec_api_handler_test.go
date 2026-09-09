/*
The three kernelspec routes, called as the router calls them.

ServeKernelResource is the one worth the trouble. It is the only route in the app that reads a file
off disk chosen by name from the URL, and until these tests it had no coverage at all: a kernel that
is not installed served a file relative to the server's working directory, and a resource name with
no dot in it panicked the handler on the line after the read succeeded.

mux.SetURLVars stands in for the router, which is what puts {kernel} and {resource} where the
handler looks for them.
*/
package kernelspec

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// serveResource calls the handler the way the route would, and answers the recorder.
func serveResource(kernel, resource string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, "/static/kernelspecs/"+kernel+"/"+resource, nil)
	request = mux.SetURLVars(request, map[string]string{"kernel": kernel, "resource": resource})

	recorder := httptest.NewRecorder()
	ServeKernelResource(recorder, request)
	return recorder
}

func TestAKernelsOwnLogoIsServedWithItsType(t *testing.T) {
	kernels := jupyterPath(t)
	dir := kernelDir(t, kernels, "python3", pythonSpec)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "logo-64x64.png"), []byte("png bytes"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "kernel.js"), []byte("// js"), 0o644))

	png := serveResource("python3", "logo-64x64.png")
	assert.Equal(t, http.StatusOK, png.Code)
	assert.Equal(t, "image/png", png.Header().Get("Content-Type"))
	assert.Equal(t, "png bytes", png.Body.String())

	// Anything the switch does not name is handed over as bytes rather than guessed at.
	js := serveResource("python3", "kernel.js")
	assert.Equal(t, http.StatusOK, js.Code)
	assert.Equal(t, "application/octet-stream", js.Header().Get("Content-Type"))
}

func TestAResourceRequestCannotReachOutsideTheKernelsOwnFolder(t *testing.T) {
	kernels := jupyterPath(t)
	kernelDir(t, kernels, "python3", pythonSpec)
	require.NoError(t, os.WriteFile(filepath.Join(kernels, "secrets.txt"), []byte("shh"), 0o644))

	// A working directory with something worth reading in it, for the case where the kernel is not
	// installed and the path used to be resolved from here.
	cwd := t.TempDir()
	t.Chdir(cwd)
	require.NoError(t, os.WriteFile(filepath.Join(cwd, "go.mod"), []byte("module secret"), 0o644))

	cases := map[string]struct{ kernel, resource string }{
		"a kernel nobody installed":    {"nosuchkernel", "go.mod"},
		"a kernel installed, no file":  {"python3", "nothing-here.png"},
		"climbing out of the spec dir": {"python3", "../secrets.txt"},
		"climbing further still":       {"python3", "../../../etc/passwd"},
		"the spec directory itself":    {"python3", "."},
		"an unknown kernel, no dot":    {"nosuchkernel", "LICENSE"},
		"an installed kernel, no dot":  {"python3", "LICENSE"},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			// A panic here is the failure: the extension was taken with [1:], so a resource with no
			// dot in it took the handler down once the read had succeeded.
			recorder := serveResource(c.kernel, c.resource)

			assert.Equal(t, http.StatusNotFound, recorder.Code)
			assert.NotContains(t, recorder.Body.String(), "module secret")
			assert.NotContains(t, recorder.Body.String(), "shh")
		})
	}
}

/*
A resource with no extension, which the kernel really does own.

Separate from the refusals above because this one has to be *served*, not refused — it is the case
that proves the fix is about how the extension is read rather than about turning the name away.
*/
func TestAResourceWithNoExtensionIsServedRatherThanCrashing(t *testing.T) {
	kernels := jupyterPath(t)
	dir := kernelDir(t, kernels, "python3", pythonSpec)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "LICENSE"), []byte("MIT"), 0o644))

	recorder := serveResource("python3", "LICENSE")

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "application/octet-stream", recorder.Header().Get("Content-Type"))
	assert.Equal(t, "MIT", recorder.Body.String())
}

func TestTheKernelspecsAreListedWithTheirResources(t *testing.T) {
	kernels := jupyterPath(t)
	dir := kernelDir(t, kernels, "python3", pythonSpec)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "logo-64x64.png"), []byte("png"), 0o644))

	recorder := httptest.NewRecorder()
	KernelspecAPIHandler(recorder, httptest.NewRequest(http.MethodGet, "/api/kernelspecs", nil))
	require.Equal(t, http.StatusOK, recorder.Code)

	var answer KernelspecResponse
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &answer), "body was %s", recorder.Body)

	require.Contains(t, answer.Kernespecs, "python3")
	assert.Equal(t, "Python 3", answer.Kernespecs["python3"].Spec.DisplayName)

	// The logo is offered at the route that serves it, which is the pairing these two handlers make.
	resources, ok := answer.Kernespecs["python3"].Resources.(map[string]interface{})
	require.True(t, ok, "resources were %T", answer.Kernespecs["python3"].Resources)
	assert.Equal(t, "/static/kernelspecs/python3/logo-64x64.png", resources["logo-64x64"])
}

func TestOneKernelspecIsAskedForByName(t *testing.T) {
	kernels := jupyterPath(t)
	kernelDir(t, kernels, "python3", pythonSpec)

	request := httptest.NewRequest(http.MethodGet, "/api/kernelspecs/python3", nil)
	request = mux.SetURLVars(request, map[string]string{"kernelName": "python3"})

	recorder := httptest.NewRecorder()
	SingleKernelspecAPIHandler(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	var spec KernelSpecJsonData
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &spec), "body was %s", recorder.Body)
	assert.Equal(t, "Python 3", spec.DisplayName)
}
