//go:build !apiserver

package http

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAReleaseBuildTrustsNoDevServer(t *testing.T) {
	assert.Empty(t, DevOrigins())
	assert.False(t, SameOrigin(request("localhost:8048", "http://localhost:3000")))
}
