package agents

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMentionsGoToTheAgentWithTheMessage(t *testing.T) {
	_, chat, files := fakeChat(t)

	require.NoError(t, chat.Prompt("look at these",
		Mention{Kind: "file", Path: "data/raw.csv", Label: "raw.csv"},
		Mention{Kind: "cell", Path: "fit.ipynb", Label: "fit.ipynb · cell 4", CellID: "c4", Text: "model.fit(x)"},
		Mention{Kind: "output", Path: "fit.ipynb", Label: "output of cell 4", CellID: "c4", Text: "ValueError"},
	))
	events := waitFor(t, chat, turnEnded)

	root := "file://" + filepath.ToSlash(files.root)
	assert.Equal(t, strings.Join([]string{
		"link data/raw.csv " + root + "/data/raw.csv",
		"resource " + root + "/fit.ipynb#cell=c4 model.fit(x)",
		"resource " + root + "/fit.ipynb#cell=c4&output ValueError",
	}, "\n"), agentText(events))
	assert.Equal(t, []Mention{
		{Kind: "file", Path: "data/raw.csv", Label: "raw.csv"},
		{Kind: "cell", Path: "fit.ipynb", Label: "fit.ipynb · cell 4", CellID: "c4"},
		{Kind: "output", Path: "fit.ipynb", Label: "output of cell 4", CellID: "c4"},
	}, events[0].Mentions, "the log keeps what was mentioned, not its text")
}

func TestAnAgentWithoutEmbeddedContextIsGivenACellInTheMessage(t *testing.T) {
	t.Setenv("ZASPER_FAKE_AGENT_PLAIN", "1")
	_, chat, _ := fakeChat(t)

	require.NoError(t, chat.Prompt("why", Mention{Kind: "cell", Path: "fit.ipynb", Label: "fit.ipynb · cell 4", CellID: "c4", Text: "model.fit(x)\n"}))

	assert.Equal(t, "text fit.ipynb · cell 4:\n```\nmodel.fit(x)\n```", agentText(waitFor(t, chat, turnEnded)))
}

func TestAMentionOutsideTheProjectIsRefused(t *testing.T) {
	_, chat, _ := fakeChat(t)

	assert.Error(t, chat.Prompt("read", Mention{Kind: "file", Path: "../../etc/passwd"}))
	assert.Error(t, chat.Prompt("read", Mention{Kind: "secret", Path: "a.py"}))
	assert.Empty(t, chatEvents(chat))
}
