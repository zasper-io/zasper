package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A module beside the notebook that shadows one ipykernel imports as it starts. Before -P the kernel
// imported it, which ran it, and then failed to start.
func TestAKernelStartsBesideAModuleThatShadowsTheStandardLibrary(t *testing.T) {
	srv, project := testServer(t)
	kernelName := requireKernel(t)
	ran := filepath.Join(t.TempDir(), "ran")
	require.NoError(t, os.WriteFile(filepath.Join(project, "pathlib.py"),
		[]byte("open("+quote(ran)+", 'w').write('ran')\n"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(project, "mymodule.py"), []byte("VALUE = 42\n"), 0o644))

	created := startSession(t, srv, project, kernelName, "beside.ipynb")
	conn, _, err := websocket.DefaultDialer.Dial(
		wsURL(t, srv, "/ws/kernels/"+created.Kernel.Id+"/channels")+"?session_id="+created.Id, nil)
	require.NoError(t, err)
	defer conn.Close()

	msgId := executeOverSocket(t, conn, created.Id, "import mymodule\nmymodule.VALUE")
	result := awaitExecuteResult(t, conn, msgId, 60*time.Second)
	assert.Equal(t, "42", result["data"].(map[string]any)["text/plain"], "a module beside the notebook still imports")
	assert.NoFileExists(t, ran, "the shadowing pathlib.py ran")
}

func quote(s string) string { return "'" + s + "'" }
