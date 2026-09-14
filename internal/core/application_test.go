package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAnAccessTokenIsLongAndDifferentEveryTime(t *testing.T) {
	seen := map[string]bool{}
	for range 50 {
		token, err := GenerateRandomToken(16)
		require.NoError(t, err)

		assert.Len(t, token, 32, "16 bytes of hex is 32 characters")
		assert.False(t, seen[token], "the same token was generated twice")
		seen[token] = true
	}
}
