package kernelspec

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeUV creates a venv and installs ipykernel into one the way uv lays them out, without a network.
const fakeUV = `#!/bin/sh
case "$1" in
venv)
  mkdir -p "$2/bin" "$2/lib/python3.12/site-packages"
  printf 'version_info = 3.12.4\n' > "$2/pyvenv.cfg"
  printf '#!/bin/sh\nexit 0\n' > "$2/bin/python3"
  chmod +x "$2/bin/python3"
  echo "Creating virtual environment at: $2" ;;
pip)
  venv=$(dirname "$(dirname "$4")")
  mkdir -p "$venv/lib/python3.12/site-packages/ipykernel"
  touch "$venv/lib/python3.12/site-packages/ipykernel/__init__.py"
  echo "Installed 1 package" ;;
esac
`

// fakeBase is a Python whose `-m venv` makes a venv whose `-m pip install ipykernel` installs it.
const fakeBase = `#!/bin/sh
[ "$1 $2" = "-m venv" ] || exit 1
mkdir -p "$3/bin" "$3/lib/python3.12/site-packages"
printf 'version = 3.12.4\n' > "$3/pyvenv.cfg"
cat > "$3/bin/python3" <<'EOF'
#!/bin/sh
if [ "$1 $2" = "-m pip" ]; then
  site="$(dirname "$(dirname "$0")")/lib/python3.12/site-packages"
  mkdir -p "$site/ipykernel" && touch "$site/ipykernel/__init__.py"
  echo "Successfully installed ipykernel"
fi
EOF
chmod +x "$3/bin/python3"
`

func stubSetupTools(t *testing.T, uv, base string) {
	t.Helper()
	previous := setupTools
	setupTools = func() (string, string) { return uv, base }
	t.Cleanup(func() {
		setupTools = previous
		setupMu.Lock()
		setupStatus = SetupStatus{State: "idle"}
		setupMu.Unlock()
	})
}

// projectCandidates is what defaultInterpreterCandidates finds in the project, and nothing else.
func projectCandidates(t *testing.T, project string) {
	t.Helper()
	previous := interpreterCandidates
	interpreterCandidates = func() []candidate {
		if env := projectEnvironment(project); env != "" {
			return []candidate{{path: pythonIn(env), env: env}}
		}
		return nil
	}
	t.Cleanup(func() { interpreterCandidates = previous })
}

func finished(t *testing.T) SetupStatus {
	t.Helper()
	require.Eventually(t, func() bool { return CurrentSetup().State != "running" }, 10*time.Second, 10*time.Millisecond)
	return CurrentSetup()
}

func TestSettingUpWithUvMakesTheProjectKernel(t *testing.T) {
	unixOnly(t)
	jupyterPath(t)
	project := t.TempDir()
	uv := writeTool(t, "uv", fakeUV)
	stubSetupTools(t, uv, "")
	projectCandidates(t, project)

	require.NoError(t, StartSetup(project))
	status := finished(t)

	require.Equal(t, "succeeded", status.State, "log was:\n%s", status.Log)
	assert.Equal(t, ProjectKernelName, status.Kernel)
	assert.Contains(t, status.Log, "$ "+uv+" venv "+filepath.Join(project, ".venv"))
	assert.Contains(t, status.Log, "Installed 1 package")

	spec, err := GetKernelSpec(ProjectKernelName)
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(project, ".venv", "bin", "python3"), spec.Argv[0])
}

func TestSettingUpWithoutUvUsesAPythonsOwnVenv(t *testing.T) {
	unixOnly(t)
	jupyterPath(t)
	project := t.TempDir()
	stubSetupTools(t, "", writeTool(t, "python3", fakeBase))
	projectCandidates(t, project)

	require.NoError(t, StartSetup(project))
	status := finished(t)

	require.Equal(t, "succeeded", status.State, "log was:\n%s", status.Log)
	assert.Contains(t, status.Log, "Successfully installed ipykernel")
	assert.Contains(t, GetAllSpecs(), ProjectKernelName)
}

func TestAnExistingVenvWithoutPythonIsLeftAlone(t *testing.T) {
	unixOnly(t)
	project := t.TempDir()
	mine := filepath.Join(project, ".venv", "notes.txt")
	require.NoError(t, os.MkdirAll(filepath.Dir(mine), 0o755))
	require.NoError(t, os.WriteFile(mine, []byte("mine"), 0o644))
	stubSetupTools(t, writeTool(t, "uv", fakeUV), "")

	require.NoError(t, StartSetup(project))
	status := finished(t)

	assert.Equal(t, "failed", status.State)
	assert.Contains(t, status.Error, "remove it and try again")
	assert.FileExists(t, mine)
}

func TestWithNoPythonAtAllTheSetupSaysSo(t *testing.T) {
	stubSetupTools(t, "", "")

	require.NoError(t, StartSetup(t.TempDir()))
	status := finished(t)

	assert.Equal(t, "failed", status.State)
	assert.Contains(t, status.Error, "no Python was found")
}

func TestASecondSetupWhileOneRunsIsRefused(t *testing.T) {
	stubSetupTools(t, "", "")
	setupMu.Lock()
	setupStatus = SetupStatus{State: "running", Log: "$ uv venv\n"}
	setupMu.Unlock()

	assert.ErrorIs(t, StartSetup(t.TempDir()), ErrSetupRunning)

	recorder := httptest.NewRecorder()
	EnvironmentSetupHandler(recorder, httptest.NewRequest(http.MethodPost, "/api/environment/setup", nil))
	assert.Equal(t, http.StatusConflict, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"state":"running"`)

	recorder = httptest.NewRecorder()
	EnvironmentSetupStatusHandler(recorder, httptest.NewRequest(http.MethodGet, "/api/environment/setup", nil))
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "$ uv venv")
}

func writeTool(t *testing.T, name, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	require.NoError(t, os.WriteFile(path, []byte(body), 0o755))
	return path
}
