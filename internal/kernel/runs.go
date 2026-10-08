package kernel

import (
	"encoding/json"
	"strings"
	"sync"

	"github.com/go-zeromq/zmq4"
	"github.com/rs/zerolog/log"
)

const (
	// Messages a client may fall behind by before it is dropped. A dropped client reconnects and is
	// given the runs it missed, which is cheaper than holding the kernel's output for a stalled tab.
	subscriberBuffer = 4096
	// What one run's outputs may hold. Past it the oldest outputs go, and a stream keeps its tail: of a
	// long training log, the end is what is read.
	maxRunOutputBytes = 8 << 20
	maxStreamBytes    = 1 << 20
	// Runs kept at once. Only runs still going, or finished with nobody watching, are kept at all.
	maxRuns = 1000
)

// Run is one execute_request sent through Zasper, folded into the outputs nbformat stores for it.
type Run struct {
	MsgID          string                   `json:"msg_id"`
	CellID         string                   `json:"cell_id"`
	Code           string                   `json:"code"`
	ExecutionCount interface{}              `json:"execution_count"`
	Outputs        []map[string]interface{} `json:"outputs"`
	// A clear_output(wait=True) is holding out for the next output to replace what is shown.
	ClearWaiting bool `json:"clear_waiting"`
	Done         bool `json:"done"`
	// When the kernel took the run up and finished it, under JupyterLab's metadata.execution keys. The
	// reply is on the shell channel, which this feed does not see, so the idle that follows it stands in.
	Execution map[string]string `json:"execution,omitempty"`

	// Some of this run was published while no client was attached.
	missed      bool
	outputBytes int
}

// Replay is what a client is given as it attaches: the runs still going, and the finished ones no
// client saw the end of.
type Replay struct {
	Runs []Run `json:"runs"`
}

// Subscription is one client's feed of the kernel's iopub messages, already encoded for the browser.
// Messages is closed when the client falls too far behind.
type Subscription struct {
	Messages chan []byte
	Replay   Replay
}

// feed is the kernel's one iopub subscription, shared by every client and by the run journal, so that
// what a client is replayed and what it is sent next never overlap or leave a gap.
type feed struct {
	mu          sync.Mutex
	subscribers map[*Subscription]struct{}
	runs        map[string]*Run
	order       []string
	finished    func(Run)
}

func (f *feed) init() {
	if f.subscribers == nil {
		f.subscribers = map[*Subscription]struct{}{}
		f.runs = map[string]*Run{}
	}
}

// Subscribe attaches a client: it is handed the runs to replay and, from the same instant, everything
// the kernel publishes.
func (km *KernelManager) Subscribe() *Subscription {
	f := &km.feed
	f.mu.Lock()
	defer f.mu.Unlock()
	f.init()

	subscription := &Subscription{Messages: make(chan []byte, subscriberBuffer)}
	kept := f.order[:0]
	for _, msgID := range f.order {
		run := f.runs[msgID]
		if !run.Done || run.missed {
			subscription.Replay.Runs = append(subscription.Replay.Runs, run.snapshot())
		}
		if run.Done {
			delete(f.runs, msgID)
			continue
		}
		run.missed = false
		kept = append(kept, msgID)
	}
	f.order = kept
	f.subscribers[subscription] = struct{}{}
	return subscription
}

// Unsubscribe detaches a client. Safe to call for one already dropped.
func (km *KernelManager) Unsubscribe(subscription *Subscription) {
	f := &km.feed
	f.mu.Lock()
	defer f.mu.Unlock()

	if _, ok := f.subscribers[subscription]; ok {
		delete(f.subscribers, subscription)
		close(subscription.Messages)
	}
}

// BeginRun records an execute_request on its way to the kernel, so its output is kept whoever is
// attached when it arrives.
func (km *KernelManager) BeginRun(msgID, cellID, code string) {
	if msgID == "" {
		return
	}
	f := &km.feed
	f.mu.Lock()
	defer f.mu.Unlock()
	f.init()

	if _, ok := f.runs[msgID]; ok {
		return
	}
	f.runs[msgID] = &Run{MsgID: msgID, CellID: cellID, Code: code, Outputs: []map[string]interface{}{}}
	f.order = append(f.order, msgID)
	if len(f.order) > maxRuns {
		delete(f.runs, f.order[0])
		f.order = f.order[1:]
	}
}

// publish folds one iopub message into the journal and passes it to every client. It answers what the
// message says the kernel is doing, as PublishedState does.
func (km *KernelManager) publish(zmsg zmq4.Msg) string {
	f := &km.feed
	f.mu.Lock()
	if len(f.subscribers) == 0 && len(f.runs) == 0 {
		f.mu.Unlock()
		return km.Session.PublishedState(zmsg)
	}

	message, ok := km.Session.decode(zmsg, "iopub")
	if !ok {
		f.mu.Unlock()
		return ""
	}
	finished := f.fold(message)

	if len(f.subscribers) > 0 {
		if payload := encodeForClient(message); payload != nil {
			for subscription := range f.subscribers {
				select {
				case subscription.Messages <- payload:
				default:
					log.Warn().Msgf("a client of kernel %s fell behind; dropping it", km.KernelId)
					delete(f.subscribers, subscription)
					close(subscription.Messages)
				}
			}
		}
	}
	notify := f.finished
	f.mu.Unlock()

	// Outside the lock: writing the notebook is file IO, and clients must not wait on it.
	if finished != nil && notify != nil {
		notify(*finished)
	}
	return stateOf(message)
}

func stateOf(message *Message) string {
	if message.Header.MsgType != "status" {
		return ""
	}
	content, _ := message.Content.(map[string]interface{})
	state, _ := content["execution_state"].(string)
	return state
}

// fold applies a message to the run it answers, and answers that run when this message finished it
// with nobody attached to see the end.
func (f *feed) fold(message *Message) *Run {
	run := f.runs[message.ParentHeader.MsgID]
	if run == nil || run.Done {
		return nil
	}
	if len(f.subscribers) == 0 {
		run.missed = true
	}

	content, _ := message.Content.(map[string]interface{})
	switch message.Header.MsgType {
	case "execute_input":
		run.ExecutionCount = content["execution_count"]
		run.timed("iopub.execute_input", message.Header.Date)
	case "stream":
		name := "stdout"
		if content["name"] == "stderr" {
			name = "stderr"
		}
		text, _ := content["text"].(string)
		run.appendStream(name, text)
	case "error":
		run.appendOutput(map[string]interface{}{
			"output_type": "error",
			"ename":       content["ename"],
			"evalue":      content["evalue"],
			"traceback":   content["traceback"],
		})
	case "execute_result":
		count := content["execution_count"]
		if count == nil {
			count = run.ExecutionCount
		}
		run.appendOutput(map[string]interface{}{
			"output_type":     "execute_result",
			"data":            content["data"],
			"metadata":        orEmpty(content["metadata"]),
			"execution_count": count,
		})
	case "display_data":
		run.appendOutput(map[string]interface{}{
			"output_type": "display_data",
			"data":        content["data"],
			"metadata":    orEmpty(content["metadata"]),
		})
	case "clear_output":
		if wait, _ := content["wait"].(bool); wait {
			run.ClearWaiting = true
		} else {
			run.ClearWaiting = false
			run.Outputs = []map[string]interface{}{}
			run.outputBytes = 0
		}
	case "status":
		if stateOf(message) == "busy" {
			run.Execution = map[string]string{}
			run.timed("iopub.status.busy", message.Header.Date)
		}
		if stateOf(message) != "idle" {
			return nil
		}
		run.timed("shell.execute_reply", message.Header.Date)
		run.Done = true
		if !run.missed {
			f.forget(run.MsgID)
			return nil
		}
		if len(f.subscribers) == 0 {
			finished := run.snapshot()
			return &finished
		}
	}
	return nil
}

func (f *feed) forget(msgID string) {
	delete(f.runs, msgID)
	for i, id := range f.order {
		if id == msgID {
			f.order = append(f.order[:i], f.order[i+1:]...)
			break
		}
	}
}

func orEmpty(metadata interface{}) interface{} {
	if metadata == nil {
		return map[string]interface{}{}
	}
	return metadata
}

// appendStream joins text onto the stream output it continues, as nbformat stores a stream.
func (run *Run) appendStream(name, text string) {
	if count := len(run.Outputs); count > 0 && !run.ClearWaiting {
		last := run.Outputs[count-1]
		if last["output_type"] == "stream" && last["name"] == name {
			previous, _ := last["text"].(string)
			joined := tail(previous + text)
			run.outputBytes += len(joined) - len(previous)
			last["text"] = joined
			run.trim()
			return
		}
	}
	run.appendOutput(map[string]interface{}{"output_type": "stream", "name": name, "text": tail(text)})
}

func (run *Run) appendOutput(output map[string]interface{}) {
	if run.ClearWaiting {
		run.ClearWaiting = false
		run.Outputs = []map[string]interface{}{}
		run.outputBytes = 0
	}
	run.Outputs = append(run.Outputs, output)
	run.outputBytes += outputSize(output)
	run.trim()
}

func (run *Run) trim() {
	for run.outputBytes > maxRunOutputBytes && len(run.Outputs) > 1 {
		run.outputBytes -= outputSize(run.Outputs[0])
		run.Outputs = run.Outputs[1:]
	}
}

// tail keeps the end of a stream that has outgrown maxStreamBytes, from a line boundary.
func tail(text string) string {
	if len(text) <= maxStreamBytes {
		return text
	}
	cut := text[len(text)-maxStreamBytes:]
	if newline := strings.IndexByte(cut, '\n'); newline >= 0 {
		cut = cut[newline+1:]
	}
	return cut
}

func outputSize(output map[string]interface{}) int {
	if text, ok := output["text"].(string); ok {
		return len(text)
	}
	encoded, _ := json.Marshal(output)
	return len(encoded)
}

func (run *Run) timed(key, date string) {
	if date == "" {
		return
	}
	if run.Execution == nil {
		run.Execution = map[string]string{}
	}
	run.Execution[key] = date
}

// snapshot copies a run deeply enough that later output does not reach the copy.
func (run *Run) snapshot() Run {
	copied := *run
	if run.Execution != nil {
		copied.Execution = make(map[string]string, len(run.Execution))
		for key, value := range run.Execution {
			copied.Execution[key] = value
		}
	}
	copied.Outputs = make([]map[string]interface{}, len(run.Outputs))
	for i, output := range run.Outputs {
		clone := make(map[string]interface{}, len(output))
		for key, value := range output {
			clone[key] = value
		}
		copied.Outputs[i] = clone
	}
	return copied
}
