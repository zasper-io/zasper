package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestShouldOpenBrowser(t *testing.T) {
	for name, testCase := range map[string]struct {
		noBrowser, console bool
		goos               string
		env                map[string]string
		want               bool
	}{
		"macOS terminal":           {console: true, goos: "darwin", want: true},
		"windows terminal":         {console: true, goos: "windows", want: true},
		"--no-browser":             {noBrowser: true, console: true, goos: "darwin", want: false},
		"JSON output is headless":  {console: false, goos: "darwin", want: false},
		"linux desktop, X11":       {console: true, goos: "linux", env: map[string]string{"DISPLAY": ":0"}, want: true},
		"linux desktop, Wayland":   {console: true, goos: "linux", env: map[string]string{"WAYLAND_DISPLAY": "wayland-0"}, want: true},
		"linux over SSH":           {console: true, goos: "linux", want: false},
		"freebsd without display":  {console: true, goos: "freebsd", want: false},
		"linux desktop, JSON logs": {console: false, goos: "linux", env: map[string]string{"DISPLAY": ":0"}, want: false},
	} {
		t.Run(name, func(t *testing.T) {
			getenv := func(key string) string { return testCase.env[key] }
			assert.Equal(t, testCase.want, shouldOpenBrowser(testCase.noBrowser, testCase.console, testCase.goos, getenv))
		})
	}
}
