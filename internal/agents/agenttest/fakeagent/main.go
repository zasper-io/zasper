// Command fakeagent is agenttest's scripted agent as a program of its own, for the browser journeys in
// e2e/, which start it from the agent panel as any other ACP agent is started. With --settings it has
// settings of its own, with --commands commands, and with --needs-sign-in a sign-in, which `login` makes.
package main

import (
	"fmt"
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
	if slices.Contains(os.Args[1:], "--needs-sign-in") {
		os.Setenv("ZASPER_FAKE_AGENT_SIGN_IN", "1")
	}
	// The terminal sign-in it offers, run as its own program in a terminal of the reader's.
	if slices.Contains(os.Args[1:], "login") {
		if err := agenttest.SignIn(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println("Signed in to the fake agent.")
		return
	}
	agenttest.Serve()
}
