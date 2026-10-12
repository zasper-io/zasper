package agents

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// projectFiles stands in for Zasper's contents, reading and writing a folder and noting who wrote.
type projectFiles struct {
	root    string
	mu      sync.Mutex
	writers map[string]string
}

func (f *projectFiles) Read(path string) (string, error) {
	data, err := os.ReadFile(filepath.Join(f.root, path))
	return string(data), err
}

func (f *projectFiles) Write(path, content, client string) error {
	f.mu.Lock()
	f.writers[path] = client
	f.mu.Unlock()
	return os.WriteFile(filepath.Join(f.root, path), []byte(content), 0o644)
}

// fakeChat starts the test binary as an agent in a fresh project.
func fakeChat(t *testing.T) (*Manager, *Chat, *projectFiles) {
	t.Helper()
	t.Setenv("ZASPER_FAKE_AGENT", "1")
	// A turn's snapshots are kept under HOME.
	t.Setenv("HOME", t.TempDir())
	root := t.TempDir()
	files := &projectFiles{root: root, writers: map[string]string{}}
	manager := New(root, files)
	chat, err := manager.Start("", os.Args[0]+" -test.run=^$")
	require.NoError(t, err)
	t.Cleanup(manager.StopAll)
	return manager, chat, files
}

// agentText is what the agent said in a log, its message chunks joined.
func agentText(events []Event) string {
	var said strings.Builder
	for _, event := range events {
		if event.Type != "update" {
			continue
		}
		var update acp.SessionUpdate
		if json.Unmarshal(event.Update, &update) == nil && update.AgentMessageChunk != nil && update.AgentMessageChunk.Content.Text != nil {
			said.WriteString(update.AgentMessageChunk.Content.Text.Text)
		}
	}
	return said.String()
}

// waitFor reads a chat's events until one matches, and answers every event seen.
func waitFor(t *testing.T, chat *Chat, match func(Event) bool) []Event {
	t.Helper()
	events, updates, unsubscribe := chat.Subscribe()
	defer unsubscribe()
	for _, event := range events {
		if match(event) {
			return events
		}
	}
	deadline := time.After(10 * time.Second)
	for {
		select {
		case event := <-updates:
			events = append(events, event)
			if match(event) {
				return events
			}
		case <-deadline:
			t.Fatalf("waited for an event that did not come; saw %+v", events)
		}
	}
}

func turnEnded(event Event) bool { return event.Type == "turn_end" }

func chatEvents(chat *Chat) []Event {
	events, _, unsubscribe := chat.Subscribe()
	unsubscribe()
	return events
}

func TestAChatStreamsTheAgentsAnswer(t *testing.T) {
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("hello"))
	events := waitFor(t, chat, turnEnded)

	assert.Equal(t, "user", events[0].Type)
	assert.Equal(t, "hello", events[0].Text)
	assert.Equal(t, "Hello there", agentText(events))
	assert.Equal(t, "end_turn", events[len(events)-1].StopReason)
}

func TestASecondPromptWaitsForTheFirstToEnd(t *testing.T) {
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("wait"))
	assert.ErrorIs(t, chat.Prompt("hello"), ErrBusy)
	waitFor(t, chat, func(Event) bool { return agentText(chatEvents(chat)) == "waiting" })

	require.NoError(t, chat.Cancel())
	events := waitFor(t, chat, turnEnded)
	assert.Equal(t, "cancelled", events[len(events)-1].StopReason)
	require.NoError(t, chat.Prompt("hello"))
}

func TestTheAgentWritesAndReadsThroughZasperAsItself(t *testing.T) {
	_, chat, files := fakeChat(t)

	require.NoError(t, chat.Prompt("write"))
	waitFor(t, chat, turnEnded)
	data, err := os.ReadFile(filepath.Join(files.root, "notes.txt"))
	require.NoError(t, err)
	assert.Equal(t, "written by the agent\n", string(data))
	assert.Equal(t, map[string]string{"notes.txt": chat.Agent}, files.writers)

	require.NoError(t, chat.Prompt("read"))
	events := waitFor(t, chat, func(e Event) bool { return e.Type == "turn_end" && e.Seq > 5 })
	assert.Contains(t, agentText(events), "notes.txt says: written by the agent")
}

func TestAPathOutsideTheProjectIsRefused(t *testing.T) {
	_, chat, _ := fakeChat(t)
	client := chatClient{chat}

	_, err := client.inProject("/etc/passwd")
	assert.ErrorContains(t, err, "outside the project")
	_, err = client.inProject("relative.txt")
	assert.ErrorContains(t, err, "absolute")
	rel, err := client.inProject(filepath.Join(chat.root, "sub", "a.txt"))
	require.NoError(t, err)
	assert.Equal(t, filepath.Join("sub", "a.txt"), rel)
}

func TestThePermissionTheAgentAsksForIsAnsweredByTheReader(t *testing.T) {
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("ask"))
	events := waitFor(t, chat, func(e Event) bool { return e.Type == "permission" })
	question := events[len(events)-1].Permission
	require.Len(t, question.Request.Options, 2)
	require.NoError(t, chat.Answer(question.ID, "allow"))

	events = waitFor(t, chat, turnEnded)
	assert.Contains(t, agentText(events), "chose allow")
}

func TestCancellingWithdrawsTheAgentsQuestion(t *testing.T) {
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("ask"))
	waitFor(t, chat, func(e Event) bool { return e.Type == "permission" })
	require.NoError(t, chat.Cancel())

	events := waitFor(t, chat, turnEnded)
	var withdrawn bool
	for _, event := range events {
		if event.Type == "answered" && event.Permission.OptionID == "" {
			withdrawn = true
		}
	}
	assert.True(t, withdrawn, "the question was not withdrawn: %+v", events)
}

func TestAnotherTabIsGivenTheWholeConversation(t *testing.T) {
	_, chat, _ := fakeChat(t)
	require.NoError(t, chat.Prompt("hello"))
	waitFor(t, chat, turnEnded)

	events, _, unsubscribe := chat.Subscribe()
	defer unsubscribe()

	assert.Equal(t, "hello", events[0].Text)
	assert.Equal(t, "Hello there", agentText(events))
	for i, event := range events {
		assert.Equal(t, i+1, event.Seq)
	}
}

func TestStoppingAChatStopsItsAgent(t *testing.T) {
	manager, chat, _ := fakeChat(t)

	require.True(t, manager.Stop(chat.ID))

	select {
	case <-chat.process.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("the agent outlived its chat")
	}
	assert.False(t, manager.Stop(chat.ID))
}

func TestAnAgentThatIsNotInstalledSaysSo(t *testing.T) {
	manager := New(t.TempDir(), &projectFiles{writers: map[string]string{}})

	_, err := manager.Start("no-such-agent", "")

	assert.ErrorContains(t, err, "not installed")
}

func TestAChatsModeAnswersWhatItCovers(t *testing.T) {
	_, chat, _ := fakeChat(t)
	require.NoError(t, chat.SetMode(ModeEdits))

	require.NoError(t, chat.Prompt("edit"))
	events := waitFor(t, chat, turnEnded)

	assert.Contains(t, agentText(events), "chose once", "allowed once, not always")
	var auto bool
	for _, event := range events {
		if event.Type == "answered" && event.Permission.Auto {
			auto = true
		}
	}
	assert.True(t, auto, "the answer was not marked as the mode's")
}

func TestAChatThatAsksLeavesTheQuestionToTheReader(t *testing.T) {
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("edit"))
	events := waitFor(t, chat, func(e Event) bool { return e.Type == "permission" })
	require.NoError(t, chat.Answer(events[len(events)-1].Permission.ID, "reject"))
	waitFor(t, chat, turnEnded)
}

func TestAModeThatDoesNotCoverAToolStillAsks(t *testing.T) {
	assert.True(t, allows(ModeAll, acp.ToolKindExecute))
	assert.False(t, allows(ModeEdits, acp.ToolKindExecute))
	assert.True(t, allows(ModeEdits, acp.ToolKindDelete))
	assert.False(t, allows(ModeAsk, acp.ToolKindEdit))
	assert.False(t, allows(ModeAll, acp.ToolKindRead))
	_, chat, _ := fakeChat(t)
	assert.Error(t, chat.SetMode("anything"))
}
