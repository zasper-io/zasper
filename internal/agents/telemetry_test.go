package agents

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/analytics"
)

func TestATurnIsCountedWithNothingOfWhatWasSaid(t *testing.T) {
	for _, stop := range []string{"end_turn", "cancelled", "refusal", "error", "a reason nobody wrote down"} {
		event := turnEvent("/Users/anna/bin/my-agent --acp", stop, 3, 120)

		require.NoError(t, analytics.Validate(analytics.EventAgentTurnEnded, event), stop)
		assert.Equal(t, "other", event["agent"], "a command line is the user's, and stays here")
	}
	assert.Equal(t, "other", turnEvent("claude-code", "a reason nobody wrote down", 0, 0)["stop_reason"])
	assert.Equal(t, "claude-code", turnEvent("claude-code", "end_turn", 0, 0)["agent"])
}
