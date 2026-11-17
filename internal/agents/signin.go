package agents

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sort"
	"strings"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

// The JSON-RPC error ACP answers with when an agent cannot go on until someone signs in.
const authRequiredCode = -32000

// How long an agent may take to sign out.
const signOutBudget = 30 * time.Second

/*
SignInMethod is one of the ways an agent offers to be signed in, as the reader is shown it. Only the
terminal kind is offered: the agent's own program, run with arguments of its choosing in a terminal the
reader can see, which Zasper opens with Command typed in. The sign-in is the agent's, kept where it
keeps it; Zasper stores none of it.
*/
type SignInMethod struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	// The command line that signs in, for a shell.
	Command string `json:"command"`
}

// SignInRequired is a start the agent refused for want of a sign-in, with the ways it offers.
type SignInRequired struct {
	Agent   string
	Methods []SignInMethod
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

// signInMethods are the agent's terminal ways of signing in, each as the command that runs it: the agent's
// own argv with the method's arguments, and its variables before it.
func signInMethods(argv []string, methods []acp.AuthMethod) []SignInMethod {
	ways := []SignInMethod{}
	for _, method := range methods {
		terminal := method.Terminal
		if terminal == nil {
			continue
		}
		way := SignInMethod{ID: terminal.Id, Name: terminal.Name, Command: shellCommand(terminal.Env, append(append([]string{}, argv...), terminal.Args...))}
		if terminal.Description != nil {
			way.Description = strings.TrimSpace(*terminal.Description)
		}
		ways = append(ways, way)
	}
	return ways
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
