package server

import (
	"sync"

	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/core"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/session"
	zwebsocket "github.com/zasper-io/zasper/internal/websocket"
)

/*
SetUp puts the server's process-wide state into its starting shape and connects the parts that cannot
import each other: killing a kernel has to close the sockets its notebooks are listening on, and a
renamed notebook's session has to follow the file.

Called once at startup, and once per test — which is why emptying the stores lives here rather than at
the call site, so that a test server is put together exactly the way the real one is.
*/
func SetUp() {
	core.SetUpActiveSessions()
	content.SetUpActiveWatcherConnections()
	kernel.SetUpStateKernels()
	zwebsocket.SetUpKernelConnections()

	// Once per process: the kernel package appends its disconnect handlers, so registering again would
	// leave two handlers closing the same connections.
	wireOnce.Do(func() {
		kernel.OnKernelDisconnect(zwebsocket.CloseKernelConnections)
		content.OnContentMoved = func(from, to string) { session.RelocateSessions(from, to) }
	})
}

var wireOnce sync.Once
