package kernel

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The kernel echoes a request's header back in parent_header on iopub, which reaches every notebook
// socket and the debug log, so the session named there must not be the key that signs messages.
func TestAMessageHeaderDoesNotCarryTheSigningKey(t *testing.T) {
	session := getSession()

	header := session.MessageFromString("kernel_info_request").Header

	assert.NotEmpty(t, header.Session)
	assert.NotEqual(t, session.Key, header.Session)
	assert.Equal(t, header.Session, session.MessageFromString("status").Header.Session, "one session names all its messages")
}
