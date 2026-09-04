package gitclient

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

/*
Every change to a repository goes through the git binary, and every question about one is answered by
go-git. The split is not arbitrary: go-git runs no hooks and reads no credential helper, and its own
COMPATIBILITY.md lists merge, rebase, stash and cherry-pick as unsupported. Running git instead means a
commit gets the user's identity out of their gitconfig, their pre-commit hook, and their signing key,
and a push gets their credential helper and their ssh-agent — none of which this package should be
reimplementing.

What it costs is a dependency on a git binary, so Available reports whether there is one and the panel
stays readable without it.
*/

// How long a command that talks to a remote is given. Without one, a push to an unreachable host holds
// the request open until the browser gives up, and holds the index lock while it does.
const networkTimeout = 2 * time.Minute

/*
indexLock serialises writes. Two requests staging at the same time — a click and a keyboard shortcut,
or a click and a retry — both take .git/index.lock, and the second fails with an error about the first
that says nothing to whoever pressed the button.
*/
var indexLock sync.Mutex

var gitBinary struct {
	once sync.Once
	path string
}

// Available reports whether there is a git binary to run. Looked up once: it is asked on every status
// read, and a PATH search per request is a syscall per request for an answer that does not change.
func Available() bool {
	gitBinary.once.Do(func() {
		path, err := exec.LookPath("git")
		if err != nil {
			log.Warn().Msg("no git binary was found; source control is read-only")
			return
		}
		gitBinary.path = path
	})
	return gitBinary.path != ""
}

/*
CommandError is a git command that failed, carrying what git said about it.

The stderr is the point. "Please tell me who you are", "could not read Username for
'https://github.com'", "Updates were rejected because the remote contains work that you do not have
locally" — each of those is something the user can act on, and each of them used to arrive in the
browser as "An error occurred while committing changes."
*/
type CommandError struct {
	Args   []string
	Stderr string
	Err    error
}

func (e *CommandError) Error() string {
	if e.Stderr != "" {
		return e.Stderr
	}
	return fmt.Sprintf("git %s failed: %v", strings.Join(e.Args, " "), e.Err)
}

func (e *CommandError) Unwrap() error {
	return e.Err
}

/*
Refusal is this package declining to do something, as opposed to failing at it.

It exists so the two are answered differently: a refusal is something the user can act on and gets a
conflict carrying its own wording, where a server fault gets a 500. Discarding an untracked file is the
case it was added for — a delete with no undo, which the request has to say it means.
*/
type Refusal struct {
	Message string
}

func (r *Refusal) Error() string {
	return r.Message
}

func refuse(format string, args ...any) error {
	return &Refusal{Message: fmt.Sprintf(format, args...)}
}

// run executes git in the repository and answers with its stdout.
func run(ctx context.Context, root string, args ...string) (string, error) {
	if !Available() {
		return "", fmt.Errorf("git is not installed")
	}

	cmd := exec.CommandContext(ctx, gitBinary.path, args...)
	cmd.Dir = root

	// Inheriting the environment, since that is where a credential helper's configuration and
	// SSH_AUTH_SOCK live, with two additions: nothing may stop to ask a terminal that is not there for
	// a password, and a read must not take a lock — a status refresh should never be what blocks a
	// commit.
	cmd.Env = append(cmd.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0")

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	log.Debug().Msgf("git %s", strings.Join(args, " "))
	if err := cmd.Run(); err != nil {
		return "", &CommandError{Args: args, Stderr: strings.TrimSpace(stderr.String()), Err: err}
	}
	return strings.TrimSpace(stdout.String()), nil
}

// write is run for the commands that change the repository, one at a time.
func write(ctx context.Context, root string, args ...string) error {
	indexLock.Lock()
	defer indexLock.Unlock()

	_, err := run(ctx, root, args...)
	return err
}

/*
initRepository creates a repository in dir.

Not a write in the sense the lock is about — there is no index yet, and nothing else in this package can
be running against a repository that does not exist — so it does not take it.
*/
func initRepository(ctx context.Context, dir string) error {
	_, err := run(ctx, dir, "init")
	return err
}

/*
pathArgs puts the paths after `--`.

A file called `-f`, or one called `HEAD`, is a file and not an option or a revision, and git only knows
which if it is told. The paths reaching here have already been confined to the repository by relPath,
so this is about how git reads them rather than about where they point.
*/
func pathArgs(args []string, paths []string) []string {
	return append(append(args, "--"), paths...)
}
