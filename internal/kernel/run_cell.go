package kernel

import (
	"context"
	"errors"
	"time"

	"github.com/go-zeromq/zmq4"
)

// ErrKernelNotReady answers a run asked of a kernel whose output could not yet be heard.
var ErrKernelNotReady = errors.New("the kernel did not answer in time")

/*
Run runs code as the cell cellID on behalf of client, as a tab's run does, with no tab needed: it is in
the run journal before it is sent, so every attached tab shows it in its cell and, with none attached,
its outputs are written into the notebook. It answers the run once the kernel is idle again, or ctx's
error, in which case the run carries on and is still journalled.
*/
func (km *KernelManager) Run(ctx context.Context, cellID, client, code string) (Run, error) {
	return km.run(ctx, cellID, client, code, false)
}

/*
Evaluate runs code for client alone, to look at the kernel's state: its output is answered and goes nowhere
else, it is in no cell and no notebook, and it does not move the execution count or the history.
*/
func (km *KernelManager) Evaluate(ctx context.Context, client, code string) (Run, error) {
	return km.run(ctx, "", client, code, true)
}

func (km *KernelManager) run(ctx context.Context, cellID, client, code string, scratch bool) (Run, error) {
	shell := km.ConnectionInfo.ConnectShell(ctx, zmq4.SocketIdentity("run-"+newID()))
	defer shell.Close()

	if err := km.awaitIopub(ctx, shell); err != nil {
		return Run{}, err
	}

	request := km.Session.MessageFromString("execute_request")
	request.Content = map[string]interface{}{
		"code":             code,
		"silent":           false,
		"store_history":    !scratch,
		"user_expressions": map[string]interface{}{},
		// Nobody may be there to answer an input(): it fails at once rather than waiting forever.
		"allow_stdin":   false,
		"stop_on_error": true,
	}
	metadata := map[string]interface{}{"cellId": cellID}
	if client != "" {
		metadata["client"] = client
	}
	request.Metadata = metadata

	done := km.awaitRun(request.Header.MsgID)
	if err := km.execute(request, cellID, client, nil, scratch); err != nil {
		km.stopAwaiting(request.Header.MsgID)
		return Run{}, err
	}
	select {
	case run := <-done:
		return run, nil
	case <-ctx.Done():
		km.stopAwaiting(request.Header.MsgID)
		return Run{}, ctx.Err()
	}
}

func (km *KernelManager) stopAwaiting(msgID string) {
	f := &km.feed
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.waiters, msgID)
}

// awaitRun is told the run msgID as it ends.
func (km *KernelManager) awaitRun(msgID string) <-chan Run {
	f := &km.feed
	f.mu.Lock()
	defer f.mu.Unlock()
	f.init()
	if f.waiters == nil {
		f.waiters = map[string]chan Run{}
	}
	done := make(chan Run, 1)
	f.waiters[msgID] = done
	return done
}

/*
awaitIopub waits until the server is hearing the kernel's output: a kernel that has only just started may
publish before anything is subscribed, and a run sent then would finish unseen. It asks for kernel_info
until a status message has been heard.
*/
func (km *KernelManager) awaitIopub(ctx context.Context, shell zmq4.Socket) error {
	for {
		if _, state, _ := km.Status(); state != "" && state != "starting" {
			return nil
		}
		if err := km.Session.send(shell, km.Session.MessageFromString("kernel_info_request")); err != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return ErrKernelNotReady
		case <-time.After(250 * time.Millisecond):
		}
	}
}
