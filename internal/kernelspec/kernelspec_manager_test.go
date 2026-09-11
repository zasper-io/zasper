/*
Finding kernelspecs on disk, and serving the files that sit beside them.

Everything here reads the filesystem, so each test builds its own Jupyter path under t.TempDir() and
swaps core.Zasper.JupyterPath for it — the same trick slowKernelspec uses in
internal/server/kernel_e2e_test.go. That global is the only input getKernelDirs has.

Two of these were written against defects. findSpecDirectory answers "" for a kernel it cannot find,
and getResourceFile joined that empty string to the resource the caller asked for — which is just the
resource, resolved against the server's own working directory, so a URL naming a kernel that does not
exist read a file from wherever Zasper was started. ServeKernelResource then took the extension with
`filepath.Ext(p)[1:]`, which panics on a name with no dot at all, and it does so *after* the read has
already succeeded.
*/
package kernelspec

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/core"
)

// jupyterPath builds a Jupyter root whose `kernels` directory is the one the package will search,
// and points core.Zasper at it for the length of the test.
func jupyterPath(t *testing.T) string {
	t.Helper()

	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, "kernels"), 0o755))

	previous := core.Zasper.JupyterPath
	core.Zasper.JupyterPath = []string{root}
	t.Cleanup(func() { core.Zasper.JupyterPath = previous })
	noInterpreters(t)

	return filepath.Join(root, "kernels")
}

// kernelDir writes a kernel.json and answers the directory holding it, which is what the package
// calls a resource dir.
func kernelDir(t *testing.T, kernels, name, kernelJSON string) string {
	t.Helper()

	dir := filepath.Join(kernels, name)
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "kernel.json"), []byte(kernelJSON), 0o644))

	return dir
}

const pythonSpec = `{
  "argv": ["python3", "-m", "ipykernel_launcher", "-f", "{connection_file}"],
  "display_name": "Python 3",
  "language": "python"
}`

func TestOnlyAFolderHoldingAKernelJsonIsAKernel(t *testing.T) {
	kernels := jupyterPath(t)

	withSpec := kernelDir(t, kernels, "python3", pythonSpec)

	empty := filepath.Join(kernels, "no-kernel-json")
	require.NoError(t, os.MkdirAll(empty, 0o755))

	notADir := filepath.Join(kernels, "kernel.json")
	require.NoError(t, os.WriteFile(notADir, []byte("{}"), 0o644))

	cases := map[string]struct {
		path string
		want bool
	}{
		"a folder with a kernel.json": {withSpec, true},
		"a folder without one":        {empty, false},
		"a file, not a folder":        {notADir, false},
		"nothing at all":              {filepath.Join(kernels, "gone"), false},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, c.want, isKernelDir(c.path))
		})
	}
}

func TestTheKernelsInADirectoryAreListedByName(t *testing.T) {
	kernels := jupyterPath(t)
	python := kernelDir(t, kernels, "python3", pythonSpec)
	other := kernelDir(t, kernels, "test-zasper", pythonSpec)

	// Neither of these is a kernel, and neither should be listed.
	require.NoError(t, os.MkdirAll(filepath.Join(kernels, "empty-folder"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(kernels, "loose.txt"), []byte("hi"), 0o644))

	assert.Equal(t, map[string]string{
		"python3":     python,
		"test-zasper": other,
	}, listKernelsIn(kernels))

	// A directory that is not there is not an error worth reporting: a Jupyter path names several
	// roots and most installs have only one.
	assert.Nil(t, listKernelsIn(filepath.Join(kernels, "nowhere")))
}

func TestASpecIsReadFromItsKernelJson(t *testing.T) {
	kernels := jupyterPath(t)
	dir := kernelDir(t, kernels, "python3", pythonSpec)

	spec, err := GetKernelSpec("python3")
	require.NoError(t, err)

	assert.Equal(t, "Python 3", spec.DisplayName)
	assert.Equal(t, "python", spec.Language)
	assert.Equal(t, []string{"python3", "-m", "ipykernel_launcher", "-f", "{connection_file}"}, spec.Argv)
	// The reader is told where the spec came from, which is what getResources and the launcher both
	// need afterwards.
	assert.Equal(t, dir, spec.ResourceDir)
}

// An empty spec used to come back instead, and the launcher panicked on its Argv[0].
func TestASpecThatCannotBeLoadedIsAnError(t *testing.T) {
	kernels := jupyterPath(t)

	for name, dir := range map[string]string{
		"not json":   kernelDir(t, kernels, "broken", "{ this is not json"),
		"no argv":    kernelDir(t, kernels, "no-argv", `{"display_name": "Nothing to run"}`),
		"no file":    filepath.Join(kernels, "missing"),
		"empty argv": kernelDir(t, kernels, "empty-argv", `{"argv": [], "display_name": "Empty"}`),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := fromResourceDir(dir)
			assert.Error(t, err)
		})
	}

	// Nor are they listed, where each was a nameless launcher entry that could not start.
	assert.Empty(t, GetAllSpecs())
}

func TestASpecsEnvIsRead(t *testing.T) {
	kernels := jupyterPath(t)
	kernelDir(t, kernels, "ir", `{
  "argv": ["R", "--slave", "-f", "{connection_file}"],
  "display_name": "R",
  "env": {"R_HOME": "/opt/R", "PATH": "/opt/R/bin:${PATH}"}
}`)

	spec, err := GetKernelSpec("ir")

	require.NoError(t, err)
	assert.Equal(t, map[string]string{"R_HOME": "/opt/R", "PATH": "/opt/R/bin:${PATH}"}, spec.Env)
	assert.Equal(t, []string{"R", "--slave", "-f", "{connection_file}"}, spec.Argv)
}

/*
A name nobody installed is not found. findSpecDirectory answers "" for it, and fromResourceDir used
to read filepath.Join("", "kernel.json") — a kernel.json in the server's working directory, whose argv
the launcher would then run.
*/
func TestAnUnknownKernelIsNotReadFromTheWorkingDirectory(t *testing.T) {
	jupyterPath(t)
	cwd := t.TempDir()
	t.Chdir(cwd)
	require.NoError(t, os.WriteFile(filepath.Join(cwd, "kernel.json"),
		[]byte(`{"argv": ["touch", "pwned"], "display_name": "From the project"}`), 0o644))

	spec, err := GetKernelSpec("no-such-kernel")

	assert.ErrorIs(t, err, ErrKernelspecNotFound)
	assert.Empty(t, spec.Argv)
}

// The Jupyter path is in priority order. Listing used to let the last directory win while launching
// took the first, so the launcher showed one kernel and started another.
func TestTheFirstDirectoryOnTheJupyterPathWins(t *testing.T) {
	user, system := t.TempDir(), t.TempDir()
	for root, name := range map[string]string{user: "Mine", system: "The system's"} {
		kernelDir(t, filepath.Join(root, "kernels"), "python3",
			`{"argv": ["python3"], "display_name": "`+name+`"}`)
	}
	previous := core.Zasper.JupyterPath
	core.Zasper.JupyterPath = []string{user, system}
	t.Cleanup(func() { core.Zasper.JupyterPath = previous })
	noInterpreters(t)

	launched, err := GetKernelSpec("python3")
	require.NoError(t, err)

	assert.Equal(t, "Mine", GetAllSpecs()["python3"].Spec.DisplayName)
	assert.Equal(t, "Mine", launched.DisplayName)
}

// Jupyter lowercases names when it lists and when it resolves, and notebooks it saved carry them so.
func TestKernelNamesAreMatchedWhateverTheirCase(t *testing.T) {
	kernels := jupyterPath(t)
	dir := kernelDir(t, kernels, "Python3", pythonSpec)

	assert.Equal(t, map[string]string{"python3": dir}, listKernelsIn(kernels))

	for _, name := range []string{"python3", "Python3", "PYTHON3"} {
		spec, err := GetKernelSpec(name)
		require.NoError(t, err, name)
		assert.Equal(t, dir, spec.ResourceDir, name)
	}
}

func TestAllTheSpecsAreFoundAcrossTheJupyterPath(t *testing.T) {
	kernels := jupyterPath(t)
	kernelDir(t, kernels, "python3", pythonSpec)
	kernelDir(t, kernels, "test-zasper", pythonSpec)

	specs := GetAllSpecs()

	require.Len(t, specs, 2)
	assert.Equal(t, "Python 3", specs["python3"].Spec.DisplayName)
	assert.Equal(t, filepath.Join(kernels, "test-zasper"), specs["test-zasper"].ResourceDir)
}

func TestAResourceIsServedFromItsOwnSpecDirectory(t *testing.T) {
	kernels := jupyterPath(t)
	dir := kernelDir(t, kernels, "python3", pythonSpec)
	logo := filepath.Join(dir, "logo-64x64.png")
	require.NoError(t, os.WriteFile(logo, []byte("png bytes"), 0o644))

	path, ok := getResourceFile("python3", "logo-64x64.png")

	assert.True(t, ok)
	assert.Equal(t, logo, path)
}

/*
A kernel nobody has installed has no files to serve.

findSpecDirectory answers "" here, and filepath.Join("", "go.mod") is "go.mod" — a path relative to
the process, not to a kernelspec. The handler then read it and answered with its contents, so
`GET /static/kernelspecs/nosuchkernel/go.mod` returned the file from whichever directory the server
was started in.
*/
func TestAResourceForAKernelThatIsNotInstalledIsRefused(t *testing.T) {
	jupyterPath(t)

	// Somewhere to be, with a file in it that a relative path would find.
	cwd := t.TempDir()
	t.Chdir(cwd)
	require.NoError(t, os.WriteFile(filepath.Join(cwd, "go.mod"), []byte("module secret"), 0o644))

	path, ok := getResourceFile("nosuchkernel", "go.mod")

	assert.False(t, ok, "a kernel that is not installed served a file")
	assert.Empty(t, path)
}

func TestAResourceOutsideTheSpecDirectoryIsRefused(t *testing.T) {
	kernels := jupyterPath(t)
	kernelDir(t, kernels, "python3", pythonSpec)

	// A sibling kernel's private file, and something further up still.
	kernelDir(t, kernels, "other", pythonSpec)
	require.NoError(t, os.WriteFile(filepath.Join(kernels, "secrets.txt"), []byte("shh"), 0o644))

	for _, resource := range []string{
		"..",
		"../secrets.txt",
		"../other/kernel.json",
		"../../../etc/passwd",
		"",
		".",
	} {
		t.Run("resource "+resource, func(t *testing.T) {
			path, ok := getResourceFile("python3", resource)

			assert.False(t, ok, "%q escaped the spec directory", resource)
			assert.Empty(t, path)
		})
	}
}

func TestUrlPathJoinKeepsTheSlashesAtBothEnds(t *testing.T) {
	cases := map[string]struct {
		pieces []string
		want   string
	}{
		"nothing":                {nil, ""},
		"one piece":              {[]string{"static"}, "static"},
		"two pieces":             {[]string{"static", "kernelspecs"}, "static/kernelspecs"},
		"a leading slash kept":   {[]string{"/static", "kernelspecs"}, "/static/kernelspecs"},
		"a trailing slash kept":  {[]string{"static", "kernelspecs/"}, "static/kernelspecs/"},
		"both kept":              {[]string{"/static", "kernelspecs/"}, "/static/kernelspecs/"},
		"inner slashes tidied":   {[]string{"/static/", "/kernelspecs/", "/python3"}, "/static/kernelspecs/python3"},
		"the root stays one":     {[]string{"/"}, "/"},
		"a url and its segments": {[]string{"http://localhost:8048", "kernelspecs", "python3"}, "http://localhost:8048/kernelspecs/python3"},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, c.want, urlPathJoin(c.pieces...))
		})
	}
}
