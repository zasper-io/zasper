package agents

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"runtime"
	"strings"
	"testing"

	acp "github.com/coder/acp-go-sdk"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/agents/agenttest"
)

// signInManager is a project whose fake agent needs a sign-in, with none made yet.
func signInManager(t *testing.T) *Manager {
	t.Helper()
	t.Setenv("ZASPER_FAKE_AGENT", "1")
	t.Setenv("ZASPER_FAKE_AGENT_SIGN_IN", "1")
	t.Setenv("HOME", t.TempDir())
	root := t.TempDir()
	manager := New(root, &projectFiles{root: root, writers: map[string]string{}})
	t.Cleanup(manager.StopAll)
	return manager
}

func startFake(manager *Manager) (*Chat, error) {
	return manager.Start(context.Background(), "", os.Args[0]+" -test.run=^$")
}

func TestAStartRefusedForWantOfASignInAnswersTheWaysToSignIn(t *testing.T) {
	manager := signInManager(t)

	_, err := startFake(manager)

	var signIn *SignInRequired
	require.True(t, errors.As(err, &signIn), "got %v", err)
	require.Len(t, signIn.Methods, 1)
	method := signIn.Methods[0]
	assert.Equal(t, "fake-login", method.ID)
	assert.Equal(t, "Fake Account", method.Name)
	assert.Equal(t, "Use a fake account", method.Description, "trimmed")
	assert.Equal(t, shellQuote(os.Args[0])+" '-test.run=^$' login", method.Command)
}

func TestOnceSignedInTheChatStartsAndSaysWhoIsSignedIn(t *testing.T) {
	manager := signInManager(t)
	require.NoError(t, agenttest.SignIn())

	chat, err := startFake(manager)
	require.NoError(t, err)

	assert.True(t, chat.CanSignOut)
	var account *Account
	for _, event := range chatEvents(chat) {
		if event.Type == "account" {
			account = event.Account
			encoded, _ := json.Marshal(event)
			assert.NotContains(t, string(encoded), "someone@example.com", "the address is never kept")
		}
	}
	require.NotNil(t, account)
	assert.Equal(t, Account{SignedIn: true, Label: "Fake Pro"}, *account)
	require.NoError(t, chat.Prompt("hello"))
	assert.Equal(t, "Hello there", agentText(waitFor(t, chat, turnEnded)))
}

func TestSigningOutAnswersTheWaysBackAndATurnThenAsksForASignIn(t *testing.T) {
	manager := signInManager(t)
	require.NoError(t, agenttest.SignIn())
	chat, err := startFake(manager)
	require.NoError(t, err)

	methods, err := chat.SignOut()
	require.NoError(t, err)
	require.Len(t, methods, 1)

	require.NoError(t, chat.Prompt("hello"))
	events := waitFor(t, chat, func(event Event) bool { return event.Type == "sign_in" })
	assert.Equal(t, "fake-login", events[len(events)-1].SignIn[0].ID)
	last := Account{SignedIn: true}
	for _, event := range events {
		if event.Type == "account" {
			last = *event.Account
		}
	}
	assert.Equal(t, Account{}, last, "the agent said it is signed out")
}

func TestAnAgentThatCannotSignOutIsNotAskedTo(t *testing.T) {
	_, chat, _ := fakeChat(t)

	assert.False(t, chat.CanSignOut)
	_, err := chat.SignOut()
	assert.Error(t, err)
}

func TestASignInIsALineAShellRunsAsItIs(t *testing.T) {
	description := "  Use a fake account "
	methods := []acp.AuthMethod{
		{Terminal: &acp.AuthMethodTerminalInline{Id: "t", Name: "Terminal", Description: &description, Args: []string{"--cli", "auth", "login"}, Env: map[string]any{"B": "two words", "A": "1"}}},
		{EnvVar: &acp.AuthMethodEnvVarInline{Id: "key", Name: "API key"}},
	}

	ways := signInMethods([]string{"npx", "-y", "@agentclientprotocol/claude-agent-acp"}, methods)

	require.Len(t, ways, 1, "only the terminal kind is offered")
	quoted := "'two words'"
	assert.Equal(t, "A=1 B="+quoted+" npx -y @agentclientprotocol/claude-agent-acp --cli auth login", ways[0].Command)
	assert.Equal(t, "Use a fake account", ways[0].Description)
	if runtime.GOOS != "windows" {
		assert.Equal(t, `'it'\''s'`, shellQuote("it's"))
	}
	assert.Equal(t, "''", shellQuote(""))
	assert.False(t, strings.ContainsAny(shellQuote("/usr/local/bin/claude-agent-acp"), `'"`))
}
