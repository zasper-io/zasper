package server

import (
	"os"
	"testing"

	"github.com/zasper-io/zasper/internal/agents/agenttest"
)

// The test binary is also an agent, for the journeys that host one: see agenttest.
func TestMain(m *testing.M) {
	if agenttest.Requested() {
		agenttest.Serve()
		os.Exit(0)
	}
	os.Exit(m.Run())
}
