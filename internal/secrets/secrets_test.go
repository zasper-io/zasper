package secrets

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func fileIn(t *testing.T) (file, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), ".zasper", "secrets.json")
	return file{path: func() (string, error) { return path, nil }}, path
}

func TestTheFileKeepsSecretsReadableByTheirOwnerAlone(t *testing.T) {
	f, path := fileIn(t)

	_, err := f.Get("connection:analytics")
	assert.ErrorIs(t, err, ErrNotFound)

	require.NoError(t, f.Set("connection:analytics", "hunter2"))
	value, err := f.Get("connection:analytics")
	require.NoError(t, err)
	assert.Equal(t, "hunter2", value)

	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())

	require.NoError(t, f.Delete("connection:analytics"))
	_, err = f.Get("connection:analytics")
	assert.ErrorIs(t, err, ErrNotFound)
}

// A keychain that cannot be reached, as on a server with no secret service.
type away struct{}

func (away) Get(string) (string, error) { return "", errors.New("no secret service") }
func (away) Set(string, string) error   { return errors.New("no secret service") }
func (away) Delete(string) error        { return errors.New("no secret service") }

func TestWithNoKeychainTheFileIsUsed(t *testing.T) {
	f, _ := fileIn(t)
	store := &fallback{primary: away{}, secondary: f}

	require.NoError(t, store.Set("k", "v"))
	value, err := store.Get("k")
	require.NoError(t, err)
	assert.Equal(t, "v", value)
	require.NoError(t, store.Delete("k"))
	_, err = store.Get("k")
	assert.ErrorIs(t, err, ErrNotFound)
}

// The keychain, in memory.
type memory map[string]string

func (m memory) Get(key string) (string, error) {
	if v, ok := m[key]; ok {
		return v, nil
	}
	return "", ErrNotFound
}
func (m memory) Set(key, value string) error { m[key] = value; return nil }
func (m memory) Delete(key string) error     { delete(m, key); return nil }

func TestAKeychainThatWorksLeavesNoCopyInTheFile(t *testing.T) {
	f, _ := fileIn(t)
	require.NoError(t, f.Set("k", "old"))
	chain := memory{}
	store := &fallback{primary: chain, secondary: f}

	require.NoError(t, store.Set("k", "new"))
	assert.Equal(t, "new", chain["k"])
	_, err := f.Get("k")
	assert.ErrorIs(t, err, ErrNotFound, "a copy in the file would outlive a change made in the keychain")
}

// A keychain that never answers, as macOS's does when it cannot ask anyone to unlock it, is given up on.
func TestAKeychainThatNeverAnswersIsGivenUpOn(t *testing.T) {
	keychainWait = 50 * time.Millisecond
	t.Cleanup(func() {
		keychainWait = 20 * time.Second
		silent.Store(false)
	})

	release := make(chan struct{})
	defer close(release)
	_, err := answered(func() (string, error) {
		<-release
		return "", nil
	})
	assert.ErrorIs(t, err, errKeychainSilent)

	// Nor is it asked again: a password read before every run would wait as long each time.
	_, err = answered(func() (string, error) { return "kept", nil })
	assert.ErrorIs(t, err, errKeychainSilent)

	silent.Store(false)
	value, err := answered(func() (string, error) { return "kept", nil })
	require.NoError(t, err)
	assert.Equal(t, "kept", value)
}
