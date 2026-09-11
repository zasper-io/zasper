package server

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/kernelspec"
)

// A logo is fetched from the address /api/kernelspecs gives for it, which is Jupyter Server's
// /kernelspecs/<name>/<file>; Zasper's older /static/kernelspecs address still answers.
func TestAKernelspecsFilesAreServedWhereTheListSaysTheyAre(t *testing.T) {
	srv, _ := testServer(t)

	root := t.TempDir()
	dir := filepath.Join(root, "kernels", "python3")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "kernel.json"),
		[]byte(`{"argv": ["python3", "-m", "ipykernel_launcher"], "display_name": "Python 3", "language": "python"}`), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "logo-64x64.png"), []byte("png bytes"), 0o644))
	core.Zasper.JupyterPath = []string{root}

	status, body := call(t, srv, http.MethodGet, "/api/kernelspecs", nil)
	require.Equal(t, http.StatusOK, status, "body was %s", body)
	logo := decode[kernelspec.KernelspecResponse](t, body).Kernespecs["python3"].Resources["logo-64x64"]
	require.Equal(t, "/kernelspecs/python3/logo-64x64.png", logo)

	for _, path := range []string{logo, "/static/kernelspecs/python3/logo-64x64.png"} {
		status, body = call(t, srv, http.MethodGet, path, nil)
		assert.Equal(t, http.StatusOK, status, path)
		assert.Equal(t, "png bytes", string(body), path)
	}
}
