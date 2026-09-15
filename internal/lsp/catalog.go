/*
Package lsp starts language servers for the file editor and connects each one to the browser over a
websocket, translating between the socket's one-JSON-message-per-frame and the Content-Length framing a
server speaks on its standard streams.

Zasper bundles no servers. It looks for one per language, says what to install when there is none, and
starts one process per connection, so a server lives exactly as long as a window wants it.
*/
package lsp

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/zasper-io/zasper/internal/config"
)

// Server is a language server Zasper knows how to start.
type Server struct {
	Name    string
	Command []string
	// The command that installs it, which is what a missing server's menu offers to copy.
	Install string
	// What has to be installed besides the program that is found: R and Julia are found by their runtime,
	// and the runtime alone serves nothing.
	Needs string
}

// Language is a language and the servers that can serve it, the preferred one first.
type Language struct {
	ID      string
	Name    string
	Servers []Server
}

func clangdInstall() string {
	if runtime.GOOS == "darwin" {
		return "xcode-select --install"
	}
	return "sudo apt install clangd"
}

// Languages are the languages the file editor asks for servers for, by the ids the frontend uses.
var Languages = []Language{
	{ID: "go", Name: "Go", Servers: []Server{
		{Name: "gopls", Command: []string{"gopls"}, Install: "go install golang.org/x/tools/gopls@latest"},
	}},
	{ID: "python", Name: "Python", Servers: []Server{
		{Name: "basedpyright", Command: []string{"basedpyright-langserver", "--stdio"}, Install: "pip install basedpyright"},
		{Name: "pyright", Command: []string{"pyright-langserver", "--stdio"}, Install: "npm install -g pyright"},
		{Name: "pylsp", Command: []string{"pylsp"}, Install: "pip install python-lsp-server"},
	}},
	{ID: "typescript", Name: "JavaScript and TypeScript", Servers: []Server{
		{Name: "typescript-language-server", Command: []string{"typescript-language-server", "--stdio"}, Install: "npm install -g typescript-language-server typescript"},
	}},
	{ID: "rust", Name: "Rust", Servers: []Server{
		{Name: "rust-analyzer", Command: []string{"rust-analyzer"}, Install: "rustup component add rust-analyzer"},
	}},
	{ID: "c", Name: "C and C++", Servers: []Server{
		{Name: "clangd", Command: []string{"clangd"}, Install: clangdInstall()},
	}},
	{ID: "r", Name: "R", Servers: []Server{
		{Name: "languageserver", Command: []string{"R", "--no-echo", "-e", "languageserver::run()"}, Install: `R -e 'install.packages("languageserver")'`, Needs: "the languageserver package"},
	}},
	{ID: "julia", Name: "Julia", Servers: []Server{
		{Name: "LanguageServer.jl", Command: []string{"julia", "--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"}, Install: `julia -e 'using Pkg; Pkg.add("LanguageServer")'`, Needs: "the LanguageServer.jl package"},
	}},
}

func languageByID(id string) (Language, bool) {
	for _, language := range Languages {
		if language.ID == id {
			return language, true
		}
	}
	return Language{}, false
}

/*
finder looks for a program on PATH and then in the folders servers are installed to without touching PATH.
Zasper started from a desktop launcher gets a thin PATH — gopls in ~/go/bin was not on it on the machine
this was written on — so PATH alone would call an installed server missing.
*/
type finder struct {
	root     string
	home     string
	lookPath func(string) (string, error)
}

func (f finder) folders() []string {
	folders := []string{
		filepath.Join(f.root, ".venv", "bin"),
		filepath.Join(f.root, "venv", "bin"),
		filepath.Join(f.root, "node_modules", ".bin"),
	}
	if gopath := os.Getenv("GOPATH"); gopath != "" {
		folders = append(folders, filepath.Join(gopath, "bin"))
	}
	if f.home != "" {
		folders = append(folders,
			filepath.Join(f.home, "go", "bin"),
			filepath.Join(f.home, ".cargo", "bin"),
			filepath.Join(f.home, ".local", "bin"),
			filepath.Join(f.home, ".juliaup", "bin"),
		)
	}
	return append(folders, "/opt/homebrew/bin", "/usr/local/bin", "/usr/local/go/bin")
}

// look answers where name is, or "" when it is nowhere Zasper looks.
func (f finder) look(name string) string {
	if strings.ContainsRune(name, filepath.Separator) {
		if found, err := exec.LookPath(name); err == nil {
			return found
		}
		return ""
	}
	if found, err := f.lookPath(name); err == nil {
		return found
	}
	for _, folder := range f.folders() {
		if found, err := exec.LookPath(filepath.Join(folder, name)); err == nil {
			return found
		}
	}
	return ""
}

// env is the process environment with the folders on PATH, so a server finds the tools it runs itself:
// gopls runs `go`.
func (f finder) env() []string {
	env := os.Environ()
	extra := strings.Join(f.folders(), string(os.PathListSeparator))
	for i, entry := range env {
		if strings.HasPrefix(entry, "PATH=") {
			env[i] = entry + string(os.PathListSeparator) + extra
			return env
		}
	}
	return append(env, "PATH="+extra)
}

// Resolved is what would be started for a language, and whether it can be.
type Resolved struct {
	Language   string `json:"language"`
	Name       string `json:"name"`
	Server     string `json:"server"`
	Command    string `json:"command"`
	Found      bool   `json:"found"`
	Path       string `json:"path"`
	Install    string `json:"install"`
	Configured bool   `json:"configured"`
	// The program found, when the server is a package inside it: julia, for LanguageServer.jl.
	Program string `json:"program,omitempty"`
	Needs   string `json:"needs,omitempty"`
	argv    []string
}

// resolve answers the server for a language: the configured command when there is one, and otherwise
// the first known server that is installed — or, when none is, the preferred one, to say what to install.
func (f finder) resolve(language Language, settings config.LanguageServerSettings) Resolved {
	preferred := language.Servers[0]
	answer := Resolved{Language: language.ID, Name: language.Name, Server: preferred.Name, Install: preferred.Install}

	if command := settings.Commands[language.ID]; command != "" {
		argv := splitCommand(command)
		answer.Configured = true
		answer.Command = command
		if len(argv) > 0 {
			answer.Server = filepath.Base(argv[0])
			answer.Path = f.look(argv[0])
			answer.Found = answer.Path != ""
			answer.argv = append([]string{answer.Path}, argv[1:]...)
		}
		return answer
	}

	for _, server := range language.Servers {
		if found := f.look(server.Command[0]); found != "" {
			answer.Server = server.Name
			answer.Install = server.Install
			if server.Needs != "" {
				answer.Program = filepath.Base(found)
				answer.Needs = server.Needs
			}
			answer.Command = strings.Join(server.Command, " ")
			answer.Path = found
			answer.Found = true
			answer.argv = append([]string{found}, server.Command[1:]...)
			return answer
		}
	}
	answer.Command = strings.Join(preferred.Command, " ")
	return answer
}

// splitCommand splits a command line on spaces, keeping what is inside single or double quotes together.
func splitCommand(command string) []string {
	words := []string{}
	var word strings.Builder
	inWord := false
	var quote rune
	for _, r := range command {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				word.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote = r
			inWord = true
		case r == ' ' || r == '\t':
			if inWord {
				words = append(words, word.String())
				word.Reset()
				inWord = false
			}
		default:
			word.WriteRune(r)
			inWord = true
		}
	}
	if inWord {
		words = append(words, word.String())
	}
	return words
}
