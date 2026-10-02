package updates

import (
	"os"
	"path/filepath"
	"strings"
)

// The install methods Zasper can tell apart.
const (
	Snap     = "snap"
	Homebrew = "homebrew"
)

// Install is how this copy of Zasper was installed, and the command that updates it, when there is one.
type Install struct {
	Method  string
	Command string
}

// DetectInstall settles the install method. stamp is what the build was stamped with, which is how a
// channel that builds its own binary says so. The Homebrew cask ships the same binary as the GitHub
// download, so it is recognised by where that binary lives.
func DetectInstall(stamp string) Install {
	method := stamp
	if method == "" {
		if exe, err := os.Executable(); err == nil {
			if resolved, err := filepath.EvalSymlinks(exe); err == nil {
				exe = resolved
			}
			if isHomebrewCask(exe) {
				method = Homebrew
			}
		}
	}
	install := Install{Method: method}
	if method == Homebrew {
		install.Command = "brew upgrade zasper"
	}
	return install
}

func isHomebrewCask(executable string) bool {
	return strings.Contains(filepath.ToSlash(executable), "/Caskroom/zasper/")
}
