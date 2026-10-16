// Command fakeagent is agenttest's scripted agent as a program of its own, for the browser journeys in
// e2e/, which start it from the agent panel as any other ACP agent is started.
package main

import "github.com/zasper-io/zasper/internal/agents/agenttest"

func main() {
	agenttest.Serve()
}
