// Command fakeagent is agenttest's scripted agent as a program of its own, for the browser journeys in
// e2e/, which start it from the agent panel as any other ACP agent is started. With --settings it has
// settings of its own, and with --commands commands.
package main

import (
	"os"
	"slices"

	"github.com/zasper-io/zasper/internal/agents/agenttest"
)

func main() {
	if slices.Contains(os.Args[1:], "--settings") {
		os.Setenv("ZASPER_FAKE_AGENT_SETTINGS", "1")
	}
	if slices.Contains(os.Args[1:], "--commands") {
		os.Setenv("ZASPER_FAKE_AGENT_COMMANDS", "1")
	}
	agenttest.Serve()
}
