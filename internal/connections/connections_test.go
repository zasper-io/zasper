package connections

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/secrets"
)

// memory is the keychain, in the test.
type memory map[string]string

func (m memory) Get(key string) (string, error) {
	if v, ok := m[key]; ok {
		return v, nil
	}
	return "", secrets.ErrNotFound
}
func (m memory) Set(key, value string) error { m[key] = value; return nil }
func (m memory) Delete(key string) error     { delete(m, key); return nil }

func storeIn(t *testing.T) (*Store, string, string, memory) {
	t.Helper()
	project, home := t.TempDir(), t.TempDir()
	keys := memory{}
	return &Store{project: project, home: func() (string, error) { return home, nil }, secrets: keys}, project, home, keys
}

func ptr(s string) *string { return &s }

func TestAConnectionIsKeptWithoutItsPassword(t *testing.T) {
	store, project, _, keys := storeIn(t)
	analytics := Connection{Name: "analytics", Type: "postgresql", Host: "db.internal", Port: "5432", Database: "analytics", User: "me", Scope: ScopeProject}

	require.NoError(t, store.Save(analytics, "", ptr("hunter2")))

	data, err := os.ReadFile(filepath.Join(project, ".zasper", "connections.json"))
	require.NoError(t, err)
	assert.NotContains(t, string(data), "hunter2", "the file is committed with the project")
	assert.NotContains(t, string(data), "scope")
	assert.Equal(t, "hunter2", keys["connection:"+project+":analytics"])

	list, err := store.List()
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.True(t, list[0].HasPassword)
	assert.Equal(t, ScopeProject, list[0].Scope)
	assert.Equal(t, "hunter2", store.SpecFor(list[0], nil).Password)
}

func TestSavingWithoutAPasswordKeepsTheOneStored(t *testing.T) {
	store, project, _, keys := storeIn(t)
	c := Connection{Name: "analytics", Type: "postgresql", Host: "h", Scope: ScopeProject}
	require.NoError(t, store.Save(c, "", ptr("hunter2")))

	c.Host = "h2"
	require.NoError(t, store.Save(c, "", nil))
	assert.Equal(t, "hunter2", keys["connection:"+project+":analytics"])

	c.Name = "warehouse"
	require.NoError(t, store.Save(c, "analytics", nil))
	assert.Equal(t, "hunter2", keys["connection:"+project+":warehouse"], "a rename takes its password along")
	assert.NotContains(t, keys, "connection:"+project+":analytics")

	require.NoError(t, store.Save(c, "", ptr("")))
	assert.NotContains(t, keys, "connection:"+project+":warehouse", "an empty password removes it")
}

func TestTheProjectsConnectionComesFirstAndAUsersFollowsThemAround(t *testing.T) {
	store, _, home, _ := storeIn(t)
	require.NoError(t, store.Save(Connection{Name: "warehouse", Type: "snowflake", Host: "acme", Scope: ScopeUser}, "", nil))
	require.NoError(t, store.Save(Connection{Name: "warehouse", Type: "sqlite", Path: "w.db", Scope: ScopeProject}, "", nil))
	assert.FileExists(t, filepath.Join(home, ".zasper", "connections.json"))

	found, ok := store.Find("warehouse")
	require.True(t, ok)
	assert.Equal(t, "sqlite", found.Type)
}

func TestAFileIsReadFromTheProject(t *testing.T) {
	store, project, _, _ := storeIn(t)
	spec := store.SpecFor(Connection{Name: "local", Type: "sqlite", Path: "data/local.db", Scope: ScopeProject}, nil)
	assert.Equal(t, filepath.Join(project, "data", "local.db"), spec.Path)
}

func TestWhatAFormSendsIsChecked(t *testing.T) {
	assert.Error(t, Validate(Connection{Name: "1st", Type: "sqlite", Path: "a.db"}))
	assert.Error(t, Validate(Connection{Name: "dataframes", Type: "duckdb"}), "the kernel's own")
	assert.Error(t, Validate(Connection{Name: "x", Type: "oracle"}))
	assert.Error(t, Validate(Connection{Name: "x", Type: "postgresql"}), "no host")
	assert.Error(t, Validate(Connection{Name: "x", Type: "sqlite"}), "no file")
	assert.NoError(t, Validate(Connection{Name: "x", Type: "duckdb"}), "an in-memory DuckDB")
	assert.NoError(t, Validate(Connection{Name: "x", Type: "url", URL: "trino://me@host/catalog"}))

	store, _, _, _ := storeIn(t)
	require.NoError(t, store.Save(Connection{Name: "a", Type: "duckdb", Scope: ScopeUser}, "", nil))
	assert.Error(t, store.Save(Connection{Name: "a", Type: "duckdb", Scope: "team"}, "", nil))
	require.NoError(t, store.Save(Connection{Name: "b", Type: "duckdb", Scope: ScopeUser}, "", nil))
	assert.Error(t, store.Save(Connection{Name: "b", Type: "duckdb", Scope: ScopeUser}, "a", nil), "renaming onto another")
	require.NoError(t, store.Delete(ScopeUser, "a"))
	assert.Error(t, store.Delete(ScopeUser, "a"))
}
