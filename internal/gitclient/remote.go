package gitclient

import (
	"context"

	"github.com/go-git/go-git/v5"
)

/*
push sends the current branch to its remote.

The reason this is a git command and not go-git is authentication. go-git's Push takes credentials it
has no way of finding: it reads no credential helper, knows nothing of ssh-agent, and the previous
version of this called it with an empty PushOptions — which cannot succeed against any HTTPS remote and
any SSH remote whose key needs a passphrase. Running git means the same push the user's own terminal
would do, with the same helpers and the same known_hosts.

A branch with no upstream is given one, since pushing a new branch and then having to be told to set its
upstream is a step with no decision in it.
*/
func push(ctx context.Context, repo *git.Repository, root, branch, upstream string) error {
	if !hasRemote(repo) {
		return refuse("this repository has no remote to push to")
	}

	// A remote that cannot be reached would otherwise hold the request — and the index lock — until the
	// browser gave up.
	ctx, cancel := context.WithTimeout(ctx, networkTimeout)
	defer cancel()

	if upstream != "" {
		return write(ctx, root, "push")
	}
	return write(ctx, root, "push", "--set-upstream", "origin", branch)
}
