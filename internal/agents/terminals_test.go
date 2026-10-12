package agents

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// terminalEvents is what the panel was told of the commands run, in order.
func terminalEvents(events []Event) []TerminalOutput {
	var outputs []TerminalOutput
	for _, event := range events {
		if event.Type == "terminal" {
			outputs = append(outputs, *event.Terminal)
		}
	}
	return outputs
}

func TestACommandRunsInTheProjectAndThePanelSeesItsOutput(t *testing.T) {
	_, chat, files := fakeChat(t)

	require.NoError(t, chat.Prompt("run pwd; echo oops >&2; exit 3"))
	events := waitFor(t, chat, turnEnded)

	root, err := filepath.EvalSymlinks(files.root)
	require.NoError(t, err)
	printed := root + "\noops\n"
	assert.Equal(t, "exit 3: "+printed, agentText(events))
	outputs := terminalEvents(events)
	require.NotEmpty(t, outputs)
	var shown strings.Builder
	for _, output := range outputs {
		shown.WriteString(output.Output)
	}
	assert.Equal(t, printed, shown.String())
	last := outputs[len(outputs)-1]
	assert.True(t, last.Exited)
	require.NotNil(t, last.ExitCode)
	assert.Equal(t, 3, *last.ExitCode)
}

func TestACommandEndedByASignalSaysWhich(t *testing.T) {
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("run kill -9 $$"))
	events := waitFor(t, chat, turnEnded)

	assert.Equal(t, "signal SIGKILL: ", agentText(events))
}

func TestThePanelIsSentTheEndOfALongOutput(t *testing.T) {
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("run head -c 400000 /dev/zero | tr '\\0' a; echo end"))
	events := waitFor(t, chat, turnEnded)

	assert.Len(t, agentText(events), len("exit 0: ")+400000+len("end\n"), "the agent was not given all of it")
	outputs := terminalEvents(events)
	streamed := 0
	for _, output := range outputs[:len(outputs)-1] {
		streamed += len(output.Output)
	}
	assert.LessOrEqual(t, streamed, streamedOutput)
	last := outputs[len(outputs)-1]
	assert.True(t, last.Cut)
	assert.Len(t, last.Output, tailOutput)
	assert.True(t, strings.HasSuffix(last.Output, "aaaend\n"))
}

func TestStoppingAChatStopsTheCommandsItsAgentLeftRunning(t *testing.T) {
	manager, chat, files := fakeChat(t)

	require.NoError(t, chat.Prompt("run echo $$ > pid; exec sleep 60"))
	var pid int
	require.Eventually(t, func() bool {
		data, err := os.ReadFile(filepath.Join(files.root, "pid"))
		pid, _ = strconv.Atoi(strings.TrimSpace(string(data)))
		return err == nil && pid > 0
	}, 10*time.Second, 50*time.Millisecond)

	manager.Stop(chat.ID)

	assert.Eventually(t, func() bool { return syscall.Kill(pid, 0) != nil }, 5*time.Second, 50*time.Millisecond,
		"the command outlived its chat")
}

func TestOutputIsCutOnlyBetweenCharacters(t *testing.T) {
	snowman := []byte("a☃")

	assert.Equal(t, 1, completeRunes(snowman[:2]))
	assert.Equal(t, 4, completeRunes(snowman))
	assert.Equal(t, []byte("b"), fromRuneStart(append(snowman[2:], 'b')))
}
