package agents

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOutputIsCutOnlyBetweenCharacters(t *testing.T) {
	snowman := []byte("a☃")

	assert.Equal(t, 1, completeRunes(snowman[:2]))
	assert.Equal(t, 4, completeRunes(snowman))
	assert.Equal(t, []byte("b"), fromRuneStart(append(snowman[2:], 'b')))
}
