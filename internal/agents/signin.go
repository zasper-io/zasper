package agents

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"slices"
	"sort"
	"strings"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

// The JSON-RPC error ACP answers with when an agent cannot go on until someone signs in.
const authRequiredCode = -32000

// How long an agent may take to sign out.
const signOutBudget = 30 * time.Second

// How long an agent may take to sign itself in: a sign-in in the browser waits on the reader.
const signInBudget = 10 * time.Minute

/*
SignInMethod is one of the ways an agent offers to be signed in, as the reader is shown it, of two kinds.
A terminal way is the agent's own program, run with arguments of its choosing in a terminal the reader
can see, which Zasper opens with Command typed in. An agent way the agent carries out itself when asked
to, opening the browser if it needs one. The sign-in is the agent's, kept where it keeps it; Zasper
stores none of it.
*/
type SignInMethod struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Kind        string `json:"kind"`
	// For a terminal way, the command line that signs in, for a shell.
	Command string `json:"command,omitempty"`
	// An agent way that wants a key from the reader, which Zasper keeps for it.
	TakesKey bool `json:"takes_key,omitempty"`
}

/*
signingIn is how a start signs the agent in, if it has to. With is a way to carry out before the session,
with Key when it takes one; KeyWays are the agent's ways that take a key; and Kept answers the key kept
for one of them, asked only when the agent will not open a session without a sign-in.
*/
type signingIn struct {
	With    string
	Key     string
	KeyWays []string
	Kept    func(way string) (string, bool)
}

const (
	signInTerminal = "terminal"
	signInByAgent  = "agent"
)

// SignInRequired is a start the agent refused for want of a sign-in, with the ways it offers, and the
// agent's reason when a way it was asked to carry out failed.
type SignInRequired struct {
	Agent   string
	Methods []SignInMethod
	Refused string
	message string
}

func (e *SignInRequired) Error() string { return e.message }

// Account is who an agent says it is signed in as: its own label, such as a plan, and never an address.
type Account struct {
	SignedIn bool   `json:"signed_in"`
	Label    string `json:"label,omitempty"`
}

func isAuthRequired(err error) bool {
	var request *acp.RequestError
	return errors.As(err, &request) && request.Code == authRequiredCode
}

// signInMethods are the agent's ways of signing in, in its order: a terminal way as the command that
// runs it, the agent's own argv with the method's arguments and its variables before it. A way that
// wants a key from the reader (env_var) is not offered yet.
func signInMethods(argv []string, methods []acp.AuthMethod, keyWays []string) []SignInMethod {
	ways := []SignInMethod{}
	for _, method := range methods {
		var way SignInMethod
		var description *string
		switch {
		case method.Terminal != nil:
			terminal := method.Terminal
			way = SignInMethod{ID: terminal.Id, Name: terminal.Name, Kind: signInTerminal, Command: shellCommand(terminal.Env, append(append([]string{}, argv...), terminal.Args...))}
			description = terminal.Description
		case method.Agent != nil:
			way = SignInMethod{ID: method.Agent.Id, Name: method.Agent.Name, Kind: signInByAgent, TakesKey: slices.Contains(keyWays, method.Agent.Id)}
			description = method.Agent.Description
		default:
			continue
		}
		if description != nil {
			way.Description = strings.TrimSpace(*description)
		}
		ways = append(ways, way)
	}
	return ways
}

// byAgent is the way with this id, if the agent carries it out itself.
func byAgent(ways []SignInMethod, id string) (SignInMethod, bool) {
	for _, way := range ways {
		if way.ID == id && way.Kind == signInByAgent {
			return way, true
		}
	}
	return SignInMethod{}, false
}

// authenticate asks the agent to sign itself in the way given, with key when the way takes one.
func (c *Chat) authenticate(ctx context.Context, way SignInMethod, key string) error {
	request := acp.AuthenticateRequest{MethodId: way.ID}
	if way.TakesKey {
		request.Meta = map[string]any{"apiKey": key}
	}
	_, err := c.conn.Authenticate(ctx, request)
	return err
}

// signInWithKept signs the agent in with a key kept for one of its ways, and answers that way's name.
func (c *Chat) signInWithKept(ctx context.Context, kept func(string) (string, bool)) (string, bool) {
	if kept == nil {
		return "", false
	}
	for _, way := range c.signIn {
		if !way.TakesKey {
			continue
		}
		if key, ok := kept(way.ID); ok && c.authenticate(ctx, way, key) == nil {
			return way.Name, true
		}
	}
	return "", false
}

// refusal is the agent's own reason for a failed sign-in, without JSON-RPC's framing.
func refusal(err error) string {
	var request *acp.RequestError
	if errors.As(err, &request) && request.Message != "" {
		return request.Message
	}
	return err.Error()
}

/*
planOf is the plan an agent names for its account when a session opens, for an agent that says so there
rather than in auth/status_update: Antigravity CLI, as `_meta.antigravity.tier.name` ("Google AI Pro").
*/
func planOf(meta map[string]any) string {
	vendor, _ := meta["antigravity"].(map[string]any)
	tier, _ := vendor["tier"].(map[string]any)
	name, _ := tier["name"].(string)
	return strings.TrimSpace(name)
}

// shellCommand is argv as a line a shell runs as it is, with env set for it.
func shellCommand(env map[string]any, argv []string) string {
	words := []string{}
	names := make([]string, 0, len(env))
	for name := range env {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		words = append(words, name+"="+shellQuote(fmt.Sprint(env[name])))
	}
	for _, word := range argv {
		words = append(words, shellQuote(word))
	}
	return strings.Join(words, " ")
}

// shellQuote leaves a plain word as it is and quotes anything else, the way a POSIX shell and
// PowerShell both read single quotes.
func shellQuote(word string) string {
	if word != "" && strings.IndexFunc(word, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("-_./:@=+,%", r))
	}) < 0 {
		return word
	}
	if runtime.GOOS == "windows" {
		return "'" + strings.ReplaceAll(word, "'", "''") + "'"
	}
	return "'" + strings.ReplaceAll(word, "'", `'\''`) + "'"
}

// SignOut signs the agent out, and answers the ways it offers to sign in again. The agent's sign-in is
// shared with every other use of it on this computer, which the panel asks about before this is called.
func (c *Chat) SignOut() ([]SignInMethod, error) {
	if !c.CanSignOut {
		return nil, errors.New("this agent cannot be signed out from here")
	}
	ctx, cancel := context.WithTimeout(c.lifetime, signOutBudget)
	defer cancel()
	if _, err := c.conn.Logout(ctx, acp.LogoutRequest{}); err != nil {
		return nil, err
	}
	return c.signIn, nil
}
