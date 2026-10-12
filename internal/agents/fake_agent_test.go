package agents

import (
	"os"
	"testing"

	"github.com/zasper-io/zasper/internal/agents/agenttest"
)

// The test binary is also the agent: see agenttest.
func TestMain(m *testing.M) {
	if agenttest.Requested() {
		agenttest.Serve()
		os.Exit(0)
	}
	os.Exit(m.Run())
}
