//go:build desktop

package main

import (
	"context"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/zasper-io/zasper/internal/logging"
)

/*
The desktop app is the same server as the CLI, with a window instead of a browser tab.

The window loads the server over http://127.0.0.1 rather than through Wails's own asset scheme,
because the frontend builds its websocket URLs from the page's host, every websocket checks that
the origin is the server's own, and sign-in is a cookie: all three only hold on a real loopback page.
*/
func main() {
	logging.SetUp(false)
	version = resolveVersion()
	useLoginShellPath()

	var zasper *zasperServer

	app := application.New(application.Options{
		Name:        "Zasper",
		Description: "Notebooks and code, without the weight",
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		OnShutdown: func() {
			if zasper != nil {
				zasper.Stop(5 * time.Second)
			}
		},
		RawMessageHandler: func(_ application.Window, message string, origin *application.OriginInfo) {
			if zasper == nil || origin == nil || origin.Origin != browsableURL(zasper.address) {
				return
			}
			if target, ok := strings.CutPrefix(message, "zasper:open-url:"); ok {
				openExternal(target)
			}
		},
	})

	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		// The window comes first so that the folder picker has something to attach to: shown on its
		// own, before the app has a window, macOS dismissed it at once and the app quit unseen.
		window := app.Window.NewWithOptions(application.WebviewWindowOptions{
			Title:     "Zasper",
			Width:     1400,
			Height:    900,
			MinWidth:  720,
			MinHeight: 480,
			HTML:      "<!doctype html><html><body style=\"margin:0;background:#fff\"></body></html>",
			JS:        externalLinksScript,
		})

		cwd := projectFromArgs(os.Args[1:])
		if cwd == "" {
			chosen, err := app.Dialog.OpenFile().
				SetTitle("Open a project folder").
				SetMessage("Choose the folder Zasper should open").
				CanChooseDirectories(true).
				CanChooseFiles(false).
				CanCreateDirectories(true).
				SetButtonText("Open").
				SetDirectory(homeDir()).
				AttachToWindow(window).
				PromptForSingleSelection()
			if err != nil {
				log.Error().Err(err).Msg("could not show the folder picker")
			}
			if chosen == "" {
				log.Info().Msg("no project folder chosen; quitting")
				app.Quit()
				return
			}
			cwd = chosen
		}

		// A fixed port first: the page's origin is what localStorage is kept under, so a new port every
		// launch forgot the tabs and recent files. Not 8048, which would stop the CLI starting.
		started, err := startServer(cwd, []string{"127.0.0.1:8049", "127.0.0.1:0"}, resolveTracking(true), nil)
		if err != nil {
			log.Error().Err(err).Str("project", cwd).Msg("could not start the server")
			app.Dialog.Error().SetTitle("Zasper could not start").SetMessage(err.Error()).AttachToWindow(window).Show()
			app.Quit()
			return
		}
		zasper = started
		log.Info().Str("addr", zasper.address).Str("project", cwd).Msg("zasper desktop started")

		window.SetTitle("Zasper — " + displayPath(cwd))
		window.SetURL(loginURL(zasper.address, zasper.accessToken))
	})

	if err := app.Run(); err != nil {
		log.Fatal().Err(err).Msg("desktop app stopped")
	}
}

// projectFromArgs is the folder the app was launched with, if any. Finder on older macOS passes a
// -psn_ process serial number, which is not a folder.
func projectFromArgs(args []string) string {
	for _, arg := range args {
		if strings.HasPrefix(arg, "-") {
			continue
		}
		if info, err := os.Stat(arg); err == nil && info.IsDir() {
			return arg
		}
	}
	return ""
}

func homeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

func displayPath(dir string) string {
	if home := homeDir(); home != "" && strings.HasPrefix(dir, home) {
		return "~" + strings.TrimPrefix(dir, home)
	}
	return dir
}

// openExternal hands a link the page could not open itself to the system browser. Only web and
// mail links: anything else, such as file://, is not the page's to open.
func openExternal(target string) {
	parsed, err := url.Parse(target)
	if err != nil {
		return
	}
	switch parsed.Scheme {
	case "http", "https", "mailto":
		launchBrowser(parsed.String())
	}
}

// A webview has nowhere to put a new window: WKWebView drops window.open and target="_blank"
// without a word. This sends both to the app, which opens them in the system browser. Links to the
// server itself stay in the window.
const externalLinksScript = `(() => {
  if (window.__zasperDesktop) return;
  window.__zasperDesktop = true;
  const post = (href) => {
    const target = new URL(href, location.href);
    if (target.origin === location.origin) {
      location.assign(target.href);
      return;
    }
    const message = 'zasper:open-url:' + target.href;
    if (window.webkit?.messageHandlers?.external) window.webkit.messageHandlers.external.postMessage(message);
    else if (window.chrome?.webview) window.chrome.webview.postMessage(message);
  };
  window.open = (href) => {
    if (href) post(String(href));
    return null;
  };
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download')) return;
    const external = new URL(link.href, location.href).origin !== location.origin;
    if (link.target === '_blank' || external) {
      event.preventDefault();
      post(link.href);
    }
  }, true);
})();`

/*
useLoginShellPath gives the app the PATH a terminal would have. An app started from the Finder or
the Dock inherits launchd's /usr/bin:/bin:/usr/sbin:/sbin, where no conda, pyenv or Homebrew Python
is found, so kernels and language servers would be missing that work from the CLI.
*/
func useLoginShellPath() {
	if runtime.GOOS == "windows" {
		return
	}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// -i as well as -l: conda and pyenv usually set PATH up in .zshrc or .bashrc, not the login profile.
	out, err := exec.CommandContext(ctx, shell, "-ilc", `printf '__ZASPER_PATH__%s' "$PATH"`).Output()
	if err != nil {
		log.Warn().Err(err).Str("shell", shell).Msg("could not read PATH from the login shell; kernels may not be found")
		return
	}
	// Anything a shell's startup files print comes before the marker.
	_, path, ok := strings.Cut(string(out), "__ZASPER_PATH__")
	if ok && path != "" {
		os.Setenv("PATH", path)
	}
}
