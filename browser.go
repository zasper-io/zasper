package main

import (
	"os/exec"
	"runtime"

	"github.com/rs/zerolog/log"
)

/*
shouldOpenBrowser decides whether startup opens the app in the user's browser.

Only when a person is at a terminal: JSON output means a pipe, a service manager or a container,
where there is nobody to show a window to. On Linux and the BSDs a missing DISPLAY and
WAYLAND_DISPLAY means an SSH session, where xdg-open would at best start a text browser inside
the terminal the server is logging to.
*/
func shouldOpenBrowser(noBrowser, console bool, goos string, getenv func(string) string) bool {
	if noBrowser || !console {
		return false
	}
	switch goos {
	case "darwin", "windows":
		return true
	}
	return getenv("DISPLAY") != "" || getenv("WAYLAND_DISPLAY") != ""
}

// launchBrowser opens url with the platform's own opener. A failure is worth a line but never
// worth stopping the server over: the banner already printed the URL.
func launchBrowser(url string) {
	if err := openURL(url); err != nil {
		log.Warn().Err(err).Str("url", url).Msg("could not open a browser; open the URL yourself, or pass --no-browser")
		return
	}
	log.Debug().Str("url", url).Msg("opened browser")
}

func openURL(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}
