//go:build apiserver

package http

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestADevelopmentBuildTrustsTheViteDevServer(t *testing.T) {
	assert.ElementsMatch(t, []string{"http://localhost:3000", "http://127.0.0.1:3000"}, DevOrigins())
}
