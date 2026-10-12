/*
Package agents hosts coding agents over the Agent Client Protocol: it starts an agent in the project,
holds the conversation on the server so that a reload or a second tab loses nothing, and answers what the
agent asks of the editor. The agent is the user's own, signed in with their own account; Zasper stores
nothing of it. See docs/AGENTS.md.
*/
package agents

import (
	"os/exec"
	"strings"
)

// Agent is one the panel offers.
type Agent struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// What to do when it is not found.
	Hint string `json:"hint"`
	// Answers the command that starts it in ACP mode, and false when it is not installed.
	command func() ([]string, bool)
}

// Info is an agent as the panel lists it.
type Info struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Installed bool   `json:"installed"`
	Hint      string `json:"hint"`
}

func found(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

// Known is every agent Zasper knows how to start.
var Known = []Agent{
	{
		ID:   "claude-code",
		Name: "Claude Code",
		Hint: "npm install -g @agentclientprotocol/claude-agent-acp, and sign in once by running claude",
		command: func() ([]string, bool) {
			if found("claude-agent-acp") {
				return []string{"claude-agent-acp"}, true
			}
			if found("npx") && found("claude") {
				return []string{"npx", "-y", "@agentclientprotocol/claude-agent-acp"}, true
			}
			return nil, false
		},
	},
	{
		ID:   "gemini",
		Name: "Gemini CLI",
		Hint: "npm install -g @google/gemini-cli",
		command: func() ([]string, bool) {
			return []string{"gemini", "--experimental-acp"}, found("gemini")
		},
	},
	{
		ID:   "codex",
		Name: "Codex",
		Hint: "install codex-acp, the ACP adapter for Codex, alongside the codex CLI",
		command: func() ([]string, bool) {
			return []string{"codex-acp"}, found("codex-acp")
		},
	},
}

// Catalogue lists the known agents and whether each is installed.
func Catalogue() []Info {
	infos := make([]Info, len(Known))
	for i, agent := range Known {
		_, installed := agent.command()
		infos[i] = Info{ID: agent.ID, Name: agent.Name, Installed: installed, Hint: agent.Hint}
	}
	return infos
}

// commandFor is how to start the agent id, or a custom command line, split on spaces.
func commandFor(id, custom string) ([]string, string, bool) {
	if argv := strings.Fields(custom); len(argv) > 0 {
		return argv, argv[0], true
	}
	for _, agent := range Known {
		if agent.ID == id {
			argv, ok := agent.command()
			return argv, agent.ID, ok
		}
	}
	return nil, "", false
}
