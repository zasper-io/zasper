package agents

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	acp "github.com/coder/acp-go-sdk"
	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/agents/agenttest"
	"github.com/zasper-io/zasper/internal/secrets"
)

// signInManager is a project whose fake agent needs a sign-in, with none made yet.
func signInManager(t *testing.T) *Manager {
	t.Helper()
	t.Setenv("ZASPER_FAKE_AGENT", "1")
	t.Setenv("ZASPER_FAKE_AGENT_SIGN_IN", "1")
	home := t.TempDir()
	t.Setenv("HOME", home)
	// Where os.UserHomeDir looks on Windows, and so where the agent keeps its sign-in there.
	t.Setenv("USERPROFILE", home)
	root := t.TempDir()
	manager := New(root, &projectFiles{root: root, writers: map[string]string{}})
	t.Cleanup(manager.StopAll)
	return manager
}

func startFake(manager *Manager) (*Chat, error) {
	return manager.Start(context.Background(), "", os.Args[0]+" -test.run=^$", "", "")
}

func TestAStartRefusedForWantOfASignInAnswersTheWaysToSignIn(t *testing.T) {
	manager := signInManager(t)

	_, err := startFake(manager)

	var signIn *SignInRequired
	require.True(t, errors.As(err, &signIn), "got %v", err)
	require.Len(t, signIn.Methods, 3)
	method := signIn.Methods[0]
	assert.Equal(t, "fake-login", method.ID)
	assert.Equal(t, "Fake Account", method.Name)
	assert.Equal(t, "Use a fake account", method.Description, "trimmed")
	assert.Equal(t, "terminal", method.Kind)
	assert.Equal(t, shellQuote(os.Args[0])+" '-test.run=^$' login", method.Command)
	assert.Equal(t, SignInMethod{ID: "fake-browser", Name: "Fake Browser", Kind: "agent"}, signIn.Methods[1], "in the agent's order")
	assert.Empty(t, signIn.Refused)
}

func startSigningIn(manager *Manager, way string) (*Chat, error) {
	return manager.Start(context.Background(), "", os.Args[0]+" -test.run=^$", way, "")
}

func TestAWayTheAgentCarriesOutSignsItInAndTheChatStarts(t *testing.T) {
	manager := signInManager(t)

	chat, err := startSigningIn(manager, "fake-browser")
	require.NoError(t, err)

	home, _ := os.UserHomeDir()
	_, err = os.Stat(filepath.Join(home, agenttest.SignedInMarker))
	assert.NoError(t, err, "the agent kept its sign-in")
	require.NoError(t, chat.Prompt("hello"))
	assert.Equal(t, "Hello there", agentText(waitFor(t, chat, turnEnded)))
}

func TestAWayTheAgentRefusesAnswersItsReasonWithTheWays(t *testing.T) {
	manager := signInManager(t)

	_, err := startSigningIn(manager, "fake-key")

	var signIn *SignInRequired
	require.True(t, errors.As(err, &signIn), "got %v", err)
	assert.Equal(t, "FAKE_KEY is not set.", signIn.Refused)
	assert.Len(t, signIn.Methods, 3)
	assert.Empty(t, manager.chats, "no chat is left behind")
}

func TestOnlyAWayTheAgentCarriesOutIsAskedFor(t *testing.T) {
	manager := signInManager(t)

	for _, way := range []string{"fake-login", "no-such-way"} {
		_, err := startSigningIn(manager, way)
		var signIn *SignInRequired
		assert.False(t, errors.As(err, &signIn), way)
		assert.ErrorContains(t, err, "offers no way", way)
	}
}

func TestAPlanNamedWhenTheSessionOpensIsTheAccount(t *testing.T) {
	manager := signInManager(t)
	t.Setenv("ZASPER_FAKE_AGENT_TIER", "1")
	require.NoError(t, agenttest.SignIn())

	chat, err := startFake(manager)
	require.NoError(t, err)

	var accounts []Account
	for _, event := range chatEvents(chat) {
		if event.Type == "account" {
			accounts = append(accounts, *event.Account)
		}
	}
	assert.Equal(t, []Account{{SignedIn: true, Label: "Fake Tier"}}, accounts)
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
	require.Len(t, methods, 3)

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

	ways := signInMethods([]string{"npx", "-y", "@agentclientprotocol/claude-agent-acp"}, methods, nil)

	require.Len(t, ways, 1, "a way that wants a key is not offered yet")
	quoted := "'two words'"
	assert.Equal(t, "A=1 B="+quoted+" npx -y @agentclientprotocol/claude-agent-acp --cli auth login", ways[0].Command)
	assert.Equal(t, "Use a fake account", ways[0].Description)
	if runtime.GOOS != "windows" {
		assert.Equal(t, `'it'\''s'`, shellQuote("it's"))
	}
	assert.Equal(t, "''", shellQuote(""))
	assert.False(t, strings.ContainsAny(shellQuote("/usr/local/bin/claude-agent-acp"), `'"`))
}

// keptKeys is a secrets store in memory, counting what is asked of it.
type keptKeys struct {
	values map[string]string
	asked  int
}

func (k *keptKeys) Get(key string) (string, error) {
	k.asked++
	if value, ok := k.values[key]; ok {
		return value, nil
	}
	return "", secrets.ErrNotFound
}

func (k *keptKeys) Set(key, value string) error {
	k.asked++
	k.values[key] = value
	return nil
}

func (k *keptKeys) Delete(key string) error {
	k.asked++
	delete(k.values, key)
	return nil
}

// keyManager is signInManager with its fake agent's Fake Key taking a key, as Antigravity's API key way
// does, and its keys kept in memory.
func keyManager(t *testing.T) (*Manager, *keptKeys) {
	t.Helper()
	manager := signInManager(t)
	store := &keptKeys{values: map[string]string{}}
	manager.secrets = store
	known := Known
	Known = append(append([]Agent{}, Known...), Agent{ID: os.Args[0], keyWays: []string{"fake-key"}})
	t.Cleanup(func() { Known = known })
	return manager, store
}

func startWithKey(manager *Manager, key string) (*Chat, error) {
	return manager.Start(context.Background(), "", os.Args[0]+" -test.run=^$", "fake-key", key)
}

// lastAccount is who the agent was last said to be signed in as, as the panel shows it.
func lastAccount(chat *Chat) Account {
	var account Account
	for _, event := range chatEvents(chat) {
		if event.Type == "account" {
			account = *event.Account
		}
	}
	return account
}

func TestAKeyGivenWithItsWaySignsTheAgentInAndIsKept(t *testing.T) {
	manager, store := keyManager(t)

	chat, err := startWithKey(manager, "  a-key  ")
	require.NoError(t, err)

	assert.Equal(t, map[string]string{keySecret(os.Args[0], "fake-key"): "a-key"}, store.values)
	assert.Equal(t, "Fake Key", chat.KeptKey)
	assert.Equal(t, Account{SignedIn: true, Label: "Fake Key"}, lastAccount(chat), "the way names the account")
	require.NoError(t, chat.Prompt("hello"))
	assert.Equal(t, "Hello there", agentText(waitFor(t, chat, turnEnded)))
}

func TestTheKeptKeySignsTheAgentInAtTheNextStart(t *testing.T) {
	manager, _ := keyManager(t)
	_, err := startWithKey(manager, "a-key")
	require.NoError(t, err)

	chat, err := startFake(manager)
	require.NoError(t, err, "the agent held the key only while it ran; Zasper gave it back")

	assert.Equal(t, "Fake Key", chat.KeptKey)
	assert.Equal(t, Account{SignedIn: true, Label: "Fake Key"}, lastAccount(chat))
}

func TestAWayThatTakesAKeyIsSaidSoAndNotTriedWithoutOne(t *testing.T) {
	manager, store := keyManager(t)

	_, err := startWithKey(manager, " ")

	var signIn *SignInRequired
	require.True(t, errors.As(err, &signIn), "got %v", err)
	assert.Equal(t, "No key was given.", signIn.Refused)
	assert.True(t, signIn.Methods[2].TakesKey)
	assert.False(t, signIn.Methods[1].TakesKey)
	assert.Empty(t, store.values)
}

func TestSigningOutForgetsTheKeptKey(t *testing.T) {
	manager, store := keyManager(t)
	chat, err := startWithKey(manager, "a-key")
	require.NoError(t, err)

	request := mux.SetURLVars(httptest.NewRequest(http.MethodPost, "/api/agents/chats/"+chat.ID+"/sign-out", nil), map[string]string{"chatId": chat.ID})
	answer := httptest.NewRecorder()
	manager.SignOutHandler(answer, request)

	assert.Equal(t, http.StatusOK, answer.Code)
	assert.Empty(t, store.values)
	_, err = startFake(manager)
	var signIn *SignInRequired
	assert.True(t, errors.As(err, &signIn), "signed out, and nothing kept to sign in again with")
}

func TestAnAgentWithNoWayThatTakesAKeyNeverAsksTheKeychain(t *testing.T) {
	manager := signInManager(t)
	store := &keptKeys{values: map[string]string{}}
	manager.secrets = store

	_, err := startFake(manager)
	require.Error(t, err)
	_, err = startSigningIn(manager, "fake-browser")
	require.NoError(t, err)

	assert.Zero(t, store.asked)
}
