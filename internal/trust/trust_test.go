package trust

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/config"
)

// memory is a config.json held in the test, so nothing touches the developer's own.
type memory struct {
	folders []config.TrustedFolder
	all     bool
}

func gateFor(t *testing.T, root string, flag bool, env map[string]string) (*Gate, *memory) {
	t.Helper()
	m := &memory{}
	g := New(root, flag)
	g.read = func() ([]config.TrustedFolder, bool) { return m.folders, m.all }
	g.env = func(name string) string { return env[name] }
	g.write = writer{
		add: func(path, since string) error {
			m.folders = append(m.folders, config.TrustedFolder{Path: path, Since: since})
			return nil
		},
		remove: func(path string) error {
			kept := m.folders[:0]
			for _, f := range m.folders {
				if f.Path != path {
					kept = append(kept, f)
				}
			}
			m.folders = kept
			return nil
		},
		all: func(all bool) error { m.all = all; return nil },
	}
	return g, m
}

func folders(t *testing.T) (work, project, sibling string) {
	t.Helper()
	work = t.TempDir()
	project = filepath.Join(work, "analysis")
	sibling = filepath.Join(work, "analysis-old")
	require.NoError(t, os.MkdirAll(project, 0o755))
	require.NoError(t, os.MkdirAll(sibling, 0o755))
	work, _ = filepath.EvalSymlinks(work)
	return work, filepath.Join(work, "analysis"), filepath.Join(work, "analysis-old")
}

func TestAFolderNobodyHasTrustedIsRestricted(t *testing.T) {
	_, project, _ := folders(t)
	g, _ := gateFor(t, project, false, nil)

	state := g.State()
	assert.False(t, state.Trusted)
	assert.Equal(t, "", state.By)
	assert.Equal(t, project, state.Folder)
	assert.ErrorIs(t, g.Check(), ErrUntrusted)
	assert.Equal(t, []config.TrustedFolder{}, state.Folders, "a list, not null")
}

func TestTrustingTheFolderOrOneItIsInTrustsIt(t *testing.T) {
	work, project, sibling := folders(t)

	g, _ := gateFor(t, project, false, nil)
	require.NoError(t, g.Trust(project, time.Date(2026, 10, 7, 9, 0, 0, 0, time.UTC)))
	state := g.State()
	assert.Equal(t, ByFolder, state.By)
	assert.Equal(t, "2026-10-07T09:00:00Z", state.Folders[0].Since)

	g, _ = gateFor(t, project, false, nil)
	require.NoError(t, g.Trust(work, time.Now()))
	assert.Equal(t, ByParent, g.State().By)
	assert.Equal(t, work, g.State().Through)

	g, m := gateFor(t, sibling, false, nil)
	m.folders = []config.TrustedFolder{{Path: project}}
	assert.False(t, g.Trusted(), "a folder whose name starts with a trusted one's is not in it")
}

func TestOnlyTheProjectOrAFolderItIsInCanBeTrustedHere(t *testing.T) {
	_, project, sibling := folders(t)
	g, m := gateFor(t, project, false, nil)

	assert.Error(t, g.Trust(sibling, time.Now()))
	assert.Empty(t, m.folders)
}

func TestForgettingAFolderRestrictsItAgain(t *testing.T) {
	_, project, _ := folders(t)
	g, _ := gateFor(t, project, false, nil)
	require.NoError(t, g.Trust(project, time.Now()))
	require.NoError(t, g.Forget(project))

	assert.False(t, g.Trusted())
}

func TestTrustAllTheFlagAndTheEnvironmentTrustEveryFolder(t *testing.T) {
	_, project, _ := folders(t)

	g, _ := gateFor(t, project, false, nil)
	require.NoError(t, g.SetTrustAll(true))
	assert.Equal(t, ByAll, g.State().By)

	g, m := gateFor(t, project, true, nil)
	assert.Equal(t, ByFlag, g.State().By)
	assert.Empty(t, m.folders, "--trust is this run's, and is not written down")

	g, _ = gateFor(t, project, false, map[string]string{EnvTrustAll: "1"})
	assert.Equal(t, ByEnv, g.State().By)
	assert.True(t, g.State().Env)
}

func TestASymlinkedPathIsTheFolderItPointsAt(t *testing.T) {
	_, project, _ := folders(t)
	link := filepath.Join(t.TempDir(), "link")
	require.NoError(t, os.Symlink(project, link))

	g, m := gateFor(t, link, false, nil)
	m.folders = []config.TrustedFolder{{Path: project}}
	assert.True(t, g.Trusted())
}
