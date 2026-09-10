/*
That a build without a configured PostHog secret still has a key.

GitHub Actions defines a missing secret as an empty string, so a release that injected straight over
the key would blank it on any fork — and Zasper would go on printing "Anonymous usage data: on" in
the banner while sending nothing. The fallback is what stops an absent secret from becoming a silent
behaviour change.
*/
package analytics

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPHAPIKeyFallsBackWhenNothingWasInjected(t *testing.T) {
	restore := injectedPHAPIKey
	t.Cleanup(func() { injectedPHAPIKey = restore })

	// What an unset -X, or a build in a repo with no POSTHOG_API_KEY secret, leaves behind.
	injectedPHAPIKey = ""
	assert.Equal(t, defaultPHAPIKey, phAPIKey())
	require.NotEmpty(t, phAPIKey(), "a build with no secret configured must still have a key")
}

func TestAnInjectedKeyWins(t *testing.T) {
	restore := injectedPHAPIKey
	t.Cleanup(func() { injectedPHAPIKey = restore })

	injectedPHAPIKey = "phc_a_fork_of_its_own"
	assert.Equal(t, "phc_a_fork_of_its_own", phAPIKey())
}
