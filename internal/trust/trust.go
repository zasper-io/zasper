/*
Package trust answers whether the project's own code may run: a notebook's kernel, the project's .venv,
and language servers that build it. A folder is trusted once and remembered in ~/.zasper/config.json, and
trusting a folder trusts everything under it. Until the project is trusted it is restricted: everything in
it can be read, and nothing it controls runs. docs/TRUST.md is the page for it.
*/
package trust

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/zasper-io/zasper/internal/config"
)

// ErrUntrusted is what anything that would run the project's code answers in a restricted project.
var ErrUntrusted = errors.New("this folder is not trusted: its code does not run until it is")

// How a project came to be trusted.
const (
	ByFolder = "folder"
	ByParent = "parent"
	ByAll    = "all"
	ByFlag   = "flag"
	ByEnv    = "env"
)

// EnvTrustAll is set in the Docker image, where the folder served is always its user's own.
const EnvTrustAll = "ZASPER_TRUST_ALL"

// Gate answers for one server's project.
type Gate struct {
	root string
	// --trust: this run only, and never written down.
	flag bool
	// The config's folders and its trust_all, read on every question so a change made in another window,
	// or by hand, counts at once.
	read  func() ([]config.TrustedFolder, bool)
	env   func(string) string
	write writer
	// The project's own Python, found on disk and never run, which a restricted launcher shows locked.
	environment func() string
}

type writer struct {
	add    func(path, since string) error
	remove func(path string) error
	all    func(bool) error
}

// New is the gate for the project at root. flag is --trust.
func New(root string, flag bool) *Gate {
	return &Gate{
		root:  canonical(root),
		flag:  flag,
		read:  config.Trust,
		env:   os.Getenv,
		write: writer{add: config.AddTrustedFolder, remove: config.RemoveTrustedFolder, all: config.SetTrustAll},
	}
}

// State is what /api/trust answers.
type State struct {
	// The project, which is the one folder the question is about.
	Folder  string `json:"folder"`
	Trusted bool   `json:"trusted"`
	// One of the By constants, or "" while restricted.
	By string `json:"by"`
	// The trusted folder that covers the project, when By is folder or parent.
	Through string `json:"through,omitempty"`
	// trust_all as config.json says; Env when the environment trusts every folder regardless.
	TrustAll bool                   `json:"trust_all"`
	Env      bool                   `json:"env"`
	Folders  []config.TrustedFolder `json:"folders"`
	// The project's own Python while it is restricted, so it can be shown as what trusting would start.
	Environment string `json:"environment,omitempty"`
}

// State answers whether the project is trusted, and why.
func (g *Gate) State() State {
	folders, all := g.read()
	if folders == nil {
		folders = []config.TrustedFolder{}
	}
	state := State{Folder: g.root, TrustAll: all, Env: g.env(EnvTrustAll) == "1", Folders: folders}
	switch {
	case g.flag:
		state.By = ByFlag
	case state.Env:
		state.By = ByEnv
	case all:
		state.By = ByAll
	default:
		for _, folder := range folders {
			path := canonical(folder.Path)
			if path == g.root {
				state.By, state.Through = ByFolder, folder.Path
				break
			}
			if within(g.root, path) && state.By == "" {
				state.By, state.Through = ByParent, folder.Path
			}
		}
	}
	state.Trusted = state.By != ""
	if !state.Trusted && g.environment != nil {
		state.Environment = g.environment()
	}
	return state
}

// DescribeEnvironment tells the gate how to find the project's own Python, without running it.
func (g *Gate) DescribeEnvironment(find func() string) {
	g.environment = find
}

// Trusted reports whether the project's code may run.
func (g *Gate) Trusted() bool {
	return g.State().Trusted
}

// Check is nil in a trusted project and ErrUntrusted otherwise.
func (g *Gate) Check() error {
	if g.Trusted() {
		return nil
	}
	return ErrUntrusted
}

// Trust trusts path, which is the project or a folder that holds it: nothing else is asked about here.
func (g *Gate) Trust(path string, now time.Time) error {
	path = canonical(path)
	if path != g.root && !within(g.root, path) {
		return errors.New("only the project or a folder it is in can be trusted from here")
	}
	return g.write.add(path, now.UTC().Format(time.RFC3339))
}

// Forget stops trusting path, which may be any folder in the list.
func (g *Gate) Forget(path string) error {
	return g.write.remove(path)
}

// SetTrustAll trusts every folder, or stops.
func (g *Gate) SetTrustAll(all bool) error {
	return g.write.all(all)
}

// canonical is path made absolute, with symlinks resolved where it exists, so /tmp and /private/tmp
// are one folder.
func canonical(path string) string {
	if absolute, err := filepath.Abs(path); err == nil {
		path = absolute
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	return filepath.Clean(path)
}

// within reports whether folder holds path.
func within(path, folder string) bool {
	if folder == string(filepath.Separator) {
		return path != folder
	}
	return strings.HasPrefix(path, folder+string(filepath.Separator))
}
