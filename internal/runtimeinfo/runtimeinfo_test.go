package runtimeinfo

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestARecordIsWrittenForTheUserAloneAndSweptOnceItsServerIsGone(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	path, err := Write(Info{URL: "http://127.0.0.1:1", Token: "secret", Project: "/work", PID: 42})
	require.NoError(t, err)
	stat, err := os.Stat(path)
	require.NoError(t, err)
	if runtime.GOOS != "windows" {
		assert.Equal(t, os.FileMode(0o600), stat.Mode().Perm())
	}
	listed, err := List()
	require.NoError(t, err)
	assert.Equal(t, []Info{{URL: "http://127.0.0.1:1", Token: "secret", Project: "/work", PID: 42}}, listed)

	kept, err := Write(Info{URL: "http://127.0.0.1:2", PID: 43})
	require.NoError(t, err)
	Sweep(func(info Info) bool { return info.PID == 43 })

	assert.NoFileExists(t, path)
	assert.FileExists(t, kept)
	dir, _ := Dir()
	assert.Equal(t, filepath.Dir(kept), dir)
}
