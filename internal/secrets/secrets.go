/*
Package secrets keeps passwords out of files people commit: in the system keychain where there is one,
and otherwise in ~/.zasper/secrets.json, readable by its owner alone. A data connection's password is the
first secret; an AI provider's key will be the next.
*/
package secrets

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/zalando/go-keyring"

	"github.com/zasper-io/zasper/internal/atomicfile"
)

// service names Zasper's entries in the keychain.
const service = "zasper"

// ErrNotFound is what Get answers for a key nothing was stored under.
var ErrNotFound = errors.New("no secret is stored under that name")

// Store keeps secrets by key.
type Store interface {
	Get(key string) (string, error)
	Set(key, value string) error
	Delete(key string) error
}

// Default is the keychain, falling back to the file for a machine without one: a headless Linux server or
// a container has no secret service to ask.
func Default() Store {
	return &fallback{primary: keychain{}, secondary: file{path: defaultFile}}
}

type keychain struct{}

// keychainWait bounds a keychain call. macOS's `security` waits forever on a keychain it cannot unlock with
// no one to ask, as over SSH or in a sandbox; one that has not answered by then counts as unreachable.
var keychainWait = 20 * time.Second

var errKeychainSilent = errors.New("the keychain did not answer")

// silent is set once a call has gone unanswered, and the keychain is not asked again while this server
// runs: each further call would wait as long, and leave another `security` process waiting behind it.
var silent atomic.Bool

// answered runs call, giving up after keychainWait. A call given up on is left to finish on its own: the
// keyring library takes no context to cancel it with.
func answered[T any](call func() (T, error)) (T, error) {
	if silent.Load() {
		var zero T
		return zero, errKeychainSilent
	}
	type result struct {
		value T
		err   error
	}
	done := make(chan result, 1)
	go func() {
		value, err := call()
		done <- result{value, err}
	}()
	select {
	case r := <-done:
		return r.value, r.err
	case <-time.After(keychainWait):
		silent.Store(true)
		var zero T
		return zero, errKeychainSilent
	}
}

func (keychain) Get(key string) (string, error) {
	value, err := answered(func() (string, error) { return keyring.Get(service, key) })
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrNotFound
	}
	return value, err
}

func (keychain) Set(key, value string) error {
	_, err := answered(func() (struct{}, error) { return struct{}{}, keyring.Set(service, key, value) })
	return err
}

func (keychain) Delete(key string) error {
	_, err := answered(func() (struct{}, error) { return struct{}{}, keyring.Delete(service, key) })
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}

/*
fallback asks the keychain first. A keychain that cannot be reached (an error other than not found) sends
the secret to the file instead, and a read looks in both, so a secret written while the keychain was away
is still found once it is back.
*/
type fallback struct {
	primary   Store
	secondary Store
}

func (f *fallback) Get(key string) (string, error) {
	value, err := f.primary.Get(key)
	if err == nil {
		return value, nil
	}
	return f.secondary.Get(key)
}

func (f *fallback) Set(key, value string) error {
	if err := f.primary.Set(key, value); err == nil {
		// One place for each secret: a copy left in the file would outlive a change made in the keychain.
		_ = f.secondary.Delete(key)
		return nil
	}
	return f.secondary.Set(key, value)
}

// Delete removes the secret from both. A keychain that cannot be reached is not a failure here: what the
// file held is gone, which is what was asked.
func (f *fallback) Delete(key string) error {
	_ = f.primary.Delete(key)
	return f.secondary.Delete(key)
}

func defaultFile() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".zasper", "secrets.json"), nil
}

var fileMu sync.Mutex

// file keeps secrets in one JSON object, written 0600.
type file struct {
	path func() (string, error)
}

func (f file) read() (map[string]string, string, error) {
	path, err := f.path()
	if err != nil {
		return nil, "", err
	}
	values := map[string]string{}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return values, path, nil
	}
	if err != nil {
		return nil, "", err
	}
	if err := json.Unmarshal(data, &values); err != nil {
		return nil, "", err
	}
	return values, path, nil
}

func (f file) write(path string, values map[string]string) error {
	data, err := json.MarshalIndent(values, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	_, err = atomicfile.Write(path, bytes.NewReader(append(data, '\n')), 0o600)
	return err
}

func (f file) Get(key string) (string, error) {
	fileMu.Lock()
	defer fileMu.Unlock()
	values, _, err := f.read()
	if err != nil {
		return "", err
	}
	value, ok := values[key]
	if !ok {
		return "", ErrNotFound
	}
	return value, nil
}

func (f file) Set(key, value string) error {
	fileMu.Lock()
	defer fileMu.Unlock()
	values, path, err := f.read()
	if err != nil {
		return err
	}
	values[key] = value
	return f.write(path, values)
}

func (f file) Delete(key string) error {
	fileMu.Lock()
	defer fileMu.Unlock()
	values, path, err := f.read()
	if err != nil {
		return err
	}
	if _, ok := values[key]; !ok {
		return nil
	}
	delete(values, key)
	return f.write(path, values)
}
