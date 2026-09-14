package server

import (
	"sync"

	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/kernelws"
	"github.com/zasper-io/zasper/internal/session"
)

/*
SetUp puts the server's process-wide state into its starting shape and connects the parts that cannot
import each other: a stopped kernel takes its sessions and its notebooks' sockets with it, and a renamed
notebook's session follows the file.

Called once at startup and once per test, so that a test server is put together the way the real one is.
*/
func SetUp() {
	session.SetUpActiveSessions()
	content.SetUpActiveWatcherConnections()
	kernel.SetUpStateKernels()
	kernelws.SetUpKernelConnections()

	// Once per process: handlers are appended, so registering again would run each twice. Sessions go
	// before sockets, so that a client told its socket has closed finds no session left to rejoin.
	wireOnce.Do(func() {
		kernel.OnKernelDisconnect(func(kernelId string) { session.DeleteSessionsForKernel(kernelId) })
		kernel.OnKernelDisconnect(kernelws.CloseKernelConnections)
		content.OnContentMoved = func(from, to string) { session.RelocateSessions(from, to) }
	})
}

var wireOnce sync.Once
