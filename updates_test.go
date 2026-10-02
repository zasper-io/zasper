package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zasper-io/zasper/internal/updates"
)

func aReleaseServer(t *testing.T, body string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	t.Setenv("ZASPER_UPDATE_URL", server.URL)
	t.Setenv("HOME", t.TempDir())
}

func TestTheUpdateNoticeNamesTheCommandWhenThereIsOne(t *testing.T) {
	release := &updates.Release{Version: "2.0.0", Notes: "https://zasper.io/changelog#2.0.0"}
	status := updates.Status{Version: "1.1.0", Available: true, Latest: release, UpgradeCommand: "brew upgrade zasper"}

	assert.Equal(t, []string{
		"Zasper 2.0.0 is available — you have 1.1.0",
		"Update with:   brew upgrade zasper",
		"Release notes: https://zasper.io/changelog#2.0.0",
	}, updateNotice(status))

	status.UpgradeCommand = ""
	status.Security = true
	assert.Equal(t, []string{
		"Zasper 2.0.0 is a security update — you have 1.1.0",
		"Release notes: https://zasper.io/changelog#2.0.0",
	}, updateNotice(status))

	assert.Nil(t, updateNotice(updates.Status{Version: "2.0.0", Latest: release}))
}

func TestCheckUpdateExitsWithWhatItFound(t *testing.T) {
	version = "1.1.0"
	t.Cleanup(func() { version = "" })

	for _, c := range []struct {
		body, says string
		code       int
	}{
		{`{"version":"1.1.0"}`, "Zasper 1.1.0 is the newest version.\n", 0},
		{`{"version":"2.0.0","notes":"https://zasper.io/changelog#2.0.0"}`, "Zasper 2.0.0 is available — you have 1.1.0\nRelease notes: https://zasper.io/changelog#2.0.0\n", 1},
		{`not json`, "Could not check for updates: ", 2},
	} {
		aReleaseServer(t, c.body)
		var out bytes.Buffer
		code := checkForUpdate(context.Background(), updates.New(version, updates.Install{}, ""), &out)
		assert.Equal(t, c.code, code, c.body)
		assert.Contains(t, out.String(), c.says)
	}
}

func TestCheckUpdateAnswersInTheSnap(t *testing.T) {
	version = "1.1.0"
	t.Cleanup(func() { version = "" })
	aReleaseServer(t, `{"version":"2.0.0"}`)

	var out bytes.Buffer
	code := checkForUpdate(context.Background(), updates.New(version, updates.Install{Method: updates.Snap}, ""), &out)
	assert.Equal(t, 1, code)
}
