package kernel

import (
	"context"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/go-zeromq/zmq4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
watchedKernel stands a kernel up as a PUB socket on a port of its own, which on iopub is all a kernel is.
No python here, and no client connection either — that absence is the point: what these cover is the
server hearing a kernel that nothing is attached to.

The publishing is left to the caller to repeat rather than sent once, because a SUB socket that has not
finished subscribing is not yet a subscriber and ZeroMQ drops a publication nobody is subscribed to. The
kernel handshake in channels.go keeps asking for the same reason.
*/
func watchedKernel(t *testing.T, id string) func(state string) {
	t.Helper()
	withKernels(t)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	kernel := zmq4.NewPub(ctx)
	require.NoError(t, kernel.Listen("tcp://127.0.0.1:0"))
	t.Cleanup(func() { kernel.Close() })

	_, port, err := net.SplitHostPort(kernel.Addr().String())
	require.NoError(t, err)
	iopubPort, err := strconv.Atoi(port)
	require.NoError(t, err)

	km := KernelManager{KernelId: id, KernelName: "python3", Session: getSession()}
	km.ConnectionInfo.Transport = "tcp"
	km.ConnectionInfo.IP = "127.0.0.1"
	km.ConnectionInfo.IopubPort = iopubPort
	km.stopWatching = cancel

	// In this order for the reason StartKernelManager is: activity about a kernel that is not in the
	// store is dropped.
	setActiveKernel(id, km)
	go watchKernelActivity(ctx, km)

	return func(state string) {
		status := km.Session.MessageFromString("status")
		status.Content = map[string]interface{}{"execution_state": state}
		require.NoError(t, kernel.SendMulti(zmq4.NewMsgFrom(km.Session.serialize(status)...)))
	}
}

// What a kernel publishes reaches /api/kernels with no client in the picture, which is the row the panel
// is for: a notebook closed hours ago, its kernel still running, and something has to say what it is
// doing.
func TestTheServerHearsAKernelNothingIsAttachedTo(t *testing.T) {
	publish := watchedKernel(t, "k1")

	assert.Eventually(t, func() bool {
		publish("busy")
		km, _ := ActiveKernel("k1")
		return km.ExecutionState == "busy" && km.LastActivity != ""
	}, 10*time.Second, 20*time.Millisecond)

	// And goes on hearing. Recording the first message and no more is the shape of the bug this
	// replaced: a kernel reported busy for the rest of its life because that is what it was saying when
	// the last thing listening to it went away.
	assert.Eventually(t, func() bool {
		publish("idle")
		km, _ := ActiveKernel("k1")
		return km.ExecutionState == "idle"
	}, 10*time.Second, 20*time.Millisecond)
}

// A kernel that has been stopped is not listened to any longer, and what it publishes on its way out
// does not put it back in the store.
func TestWatchingStopsWithTheKernel(t *testing.T) {
	publish := watchedKernel(t, "k1")

	require.Eventually(t, func() bool {
		publish("busy")
		km, _ := ActiveKernel("k1")
		return km.ExecutionState == "busy"
	}, 10*time.Second, 20*time.Millisecond)

	km, ok := removeActiveKernel("k1")
	require.True(t, ok)
	stopWatchingKernel(km)

	publish("idle")
	time.Sleep(100 * time.Millisecond)

	assert.Empty(t, activeKernels())
}
