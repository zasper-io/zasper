package utils

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
)

func env(values map[string]string) func(string) string {
	return func(name string) string { return values[name] }
}

func noGlob(string) []string { return nil }

func fakeGlob(matches map[string][]string) func(string) []string {
	return func(pattern string) []string { return matches[pattern] }
}

// Order is precedence, so the assertions are on order: JUPYTER_PATH, then the user's data dir, then an
// active environment, then the system, as jupyter_core has it.
func TestTheFallbackJupyterPathIsInJupytersOrder(t *testing.T) {
	home := "/home/me"
	paths := fallbackJupyterPath("linux", home, env(map[string]string{
		"JUPYTER_PATH": "/first" + string(filepath.ListSeparator) + "/second",
		"CONDA_PREFIX": "/opt/conda",
	}), "3.12", noGlob)

	assert.Equal(t, []string{
		"/first",
		"/second",
		filepath.Join(home, ".local", "share", "jupyter"),
		"/opt/conda/share/jupyter",
		"/usr/local/share/jupyter",
		"/usr/share/jupyter",
	}, paths[:6])
	assert.NotContains(t, paths, filepath.Join(home, ".local", "jupyter"), "not a Jupyter directory")
	assert.Contains(t, paths, filepath.Join(home, "miniconda3", "share", "jupyter"))
}

func TestTheUserDataDirIsTheOneIpykernelInstallsInto(t *testing.T) {
	home := "/home/me"
	cases := map[string]struct {
		goos string
		env  map[string]string
		want string
	}{
		"macOS":                 {"darwin", nil, filepath.Join(home, "Library", "Jupyter")},
		"Linux":                 {"linux", nil, filepath.Join(home, ".local", "share", "jupyter")},
		"Linux, XDG_DATA_HOME":  {"linux", map[string]string{"XDG_DATA_HOME": "/xdg"}, filepath.Join("/xdg", "jupyter")},
		"Windows":               {"windows", map[string]string{"APPDATA": "/appdata"}, filepath.Join("/appdata", "jupyter")},
		"JUPYTER_DATA_DIR wins": {"darwin", map[string]string{"JUPYTER_DATA_DIR": "/custom"}, "/custom"},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			paths := fallbackJupyterPath(c.goos, home, env(c.env), "", noGlob)
			assert.Equal(t, c.want, paths[0])
		})
	}
}

// jupyter_core puts an active environment ahead of the user's directory inside a virtualenv or a
// non-base conda env, and JUPYTER_PREFER_ENV_PATH overrides either way.
func TestAnActiveEnvironmentGoesWhereJupyterWouldPutIt(t *testing.T) {
	home := "/home/me"
	user := filepath.Join(home, ".local", "share", "jupyter")
	cases := map[string]struct {
		env       map[string]string
		envPrefix string
		envFirst  bool
	}{
		"a virtualenv":              {map[string]string{"VIRTUAL_ENV": "/venv"}, "/venv", true},
		"a conda env":               {map[string]string{"CONDA_PREFIX": "/conda/envs/work", "CONDA_DEFAULT_ENV": "work"}, "/conda/envs/work", true},
		"conda's base":              {map[string]string{"CONDA_PREFIX": "/conda", "CONDA_DEFAULT_ENV": "base"}, "/conda", false},
		"a virtualenv, told not to": {map[string]string{"VIRTUAL_ENV": "/venv", "JUPYTER_PREFER_ENV_PATH": "0"}, "/venv", false},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			paths := fallbackJupyterPath("linux", home, env(c.env), "", noGlob)
			envDir := filepath.Join(c.envPrefix, "share", "jupyter")
			assert.Equal(t, c.envFirst, slices.Index(paths, envDir) < slices.Index(paths, user))
		})
	}
}

/*
Installing Homebrew's Python made `python3` on PATH 3.14, and the fallback searched only that version's
user base — so the system Python's kernels in ~/Library/Python/3.9 vanished. Every version is searched
now, the PATH one first as `jupyter --paths` run by it would have it, then newest first.
*/
func TestEveryMacPythonsKernelsAreSearchedNotOnlyThePathOnes(t *testing.T) {
	home := "/Users/me"
	userBase := func(version string) string {
		return filepath.Join(home, "Library", "Python", version, "share", "jupyter")
	}
	clt := "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/"
	glob := fakeGlob(map[string][]string{
		filepath.Join(home, "Library", "Python", "*", "share", "jupyter"): {userBase("3.9"), userBase("3.14"), userBase("3.12")},
		clt + "*/share/jupyter": {clt + "3.9/share/jupyter", clt + "Current/share/jupyter"},
	})

	paths := fallbackJupyterPath("darwin", home, env(nil), "3.14", glob)

	i314, i312, i39 := slices.Index(paths, userBase("3.14")), slices.Index(paths, userBase("3.12")), slices.Index(paths, userBase("3.9"))
	assert.True(t, i314 >= 0 && i312 > i314 && i39 > i312, "order was %v", paths)
	assert.Contains(t, paths, clt+"3.9/share/jupyter")
	assert.NotContains(t, paths, clt+"Current/share/jupyter", "a symlink to one already listed")
}

func TestWindowsPythonFoldersAreFoundByVersion(t *testing.T) {
	home := "/home/me"
	programs := filepath.Join(home, "AppData", "Local", "Programs", "Python")
	install := func(folder string) string { return filepath.Join(programs, folder, "share", "jupyter") }
	glob := fakeGlob(map[string][]string{
		filepath.Join(programs, "Python3*", "share", "jupyter"): {install("Python39"), install("Python312"), install("Python310")},
	})

	paths := fallbackJupyterPath("windows", home, env(nil), "3.10", glob)

	i310, i312, i39 := slices.Index(paths, install("Python310")), slices.Index(paths, install("Python312")), slices.Index(paths, install("Python39"))
	assert.True(t, i310 >= 0 && i312 > i310 && i39 > i312, "order was %v", paths)
}

// What `jupyter --paths` answers comes first and keeps its order; the fallback only adds.
func TestEachDirectoryIsNamedOnceAndTheFirstPlaceWins(t *testing.T) {
	assert.Equal(t, []string{"/a", "/b", "/c"}, uniquePaths([]string{"/a", "/b", "/a", "/c", "/b"}))

	home := "/home/me"
	userDir := filepath.Join(home, ".local", "share", "jupyter")
	paths := fallbackJupyterPath("linux", home, env(map[string]string{"JUPYTER_PATH": userDir}), "", noGlob)
	assert.Equal(t, userDir, paths[0])
	assert.Equal(t, 1, len(slices.DeleteFunc(slices.Clone(paths), func(p string) bool { return p != userDir })))
}
