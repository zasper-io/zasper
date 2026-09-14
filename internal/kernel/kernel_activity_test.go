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
watchedKernel stands a kernel up as a PUB socket on a port of its own, which on iopub is all a kernel is,
and watches it. No python here, and no client connection either: what these cover is the server hearing a
kernel that nothing is attached to. It answers the manager, a way to publish a status, and a channel closed
once the watch has ended.

The publishing is left to the caller to repeat rather than sent once, because a SUB socket that has not
finished subscribing is not yet a subscriber and ZeroMQ drops a publication nobody is subscribed to.
*/
func watchedKernel(t *testing.T, id string) (*KernelManager, func(state string), <-chan struct{}) {
	t.Helper()
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	kernel := zmq4.NewPub(ctx)
	require.NoError(t, kernel.Listen("tcp://127.0.0.1:0"))
	t.Cleanup(func() { kernel.Close() })

	_, port, err := net.SplitHostPort(kernel.Addr().String())
	require.NoError(t, err)
	iopubPort, err := strconv.Atoi(port)
	require.NoError(t, err)

	km := &KernelManager{KernelId: id, KernelName: "python3", Session: getSession()}
	km.ConnectionInfo.Transport = "tcp"
	km.ConnectionInfo.IP = "127.0.0.1"
	km.ConnectionInfo.IopubPort = iopubPort
	km.stopWatching = cancel

	watched := make(chan struct{})
	go func() {
		defer close(watched)
		watchKernelActivity(ctx, km)
	}()

	publish := func(state string) {
		status := km.Session.MessageFromString("status")
		status.Content = map[string]interface{}{"execution_state": state}
		require.NoError(t, kernel.SendMulti(zmq4.NewMsgFrom(km.Session.serialize(status)...)))
	}
	return km, publish, watched
}

// What a kernel publishes reaches /api/kernels with no client in the picture, which is the row the panel
// is for: a notebook closed hours ago, its kernel still running, and something has to say what it is
// doing.
func TestTheServerHearsAKernelNothingIsAttachedTo(t *testing.T) {
	km, publish, _ := watchedKernel(t, "k1")

	assert.Eventually(t, func() bool {
		publish("busy")
		lastActivity, executionState, _ := km.Status()
		return executionState == "busy" && lastActivity != ""
	}, 10*time.Second, 20*time.Millisecond)

	// And goes on hearing, rather than reporting busy for the rest of its life because that is what it
	// was saying when the last thing listening to it went away.
	assert.Eventually(t, func() bool {
		publish("idle")
		_, executionState, _ := km.Status()
		return executionState == "idle"
	}, 10*time.Second, 20*time.Millisecond)
}

// A kernel that has been stopped is not listened to any longer.
func TestWatchingStopsWithTheKernel(t *testing.T) {
	km, publish, watched := watchedKernel(t, "k1")

	require.Eventually(t, func() bool {
		publish("busy")
		_, executionState, _ := km.Status()
		return executionState == "busy"
	}, 10*time.Second, 20*time.Millisecond)

	stopWatchingKernel(km)
	select {
	case <-watched:
	case <-time.After(5 * time.Second):
		t.Fatal("the watch outlived the kernel")
	}

	publish("idle")
	time.Sleep(100 * time.Millisecond)

	_, executionState, _ := km.Status()
	assert.Equal(t, "busy", executionState)
}
