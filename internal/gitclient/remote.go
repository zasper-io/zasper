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

// pushCurrent pushes whichever branch is checked out, working out for itself whether it needs an
// upstream first.
func pushCurrent(ctx context.Context, repo *git.Repository, root string) error {
	branch, err := getCurrentBranch(repo)
	if err != nil {
		return err
	}
	upstream, _, _ := syncState(ctx, root)
	return push(ctx, repo, root, branch, upstream)
}

/*
fetch brings the remote's refs up to date and changes nothing else.

run rather than write, unlike every other command that talks to a remote: a fetch writes no file the user
is looking at and needs no index lock, and holding one for up to networkTimeout would make a fetch from a
slow remote the reason a click on Stage does nothing.

No --prune. Fetching is the safe half of syncing — it is what someone presses to find out what is there —
and pruning deletes refs, which is not a thing to do to somebody as a side effect.
*/
func fetch(ctx context.Context, repo *git.Repository, root string) error {
	if !hasRemote(repo) {
		return refuse("this repository has no remote to fetch from")
	}

	ctx, cancel := context.WithTimeout(ctx, networkTimeout)
	defer cancel()

	_, err := run(ctx, root, "fetch")
	return err
}

/*
pull updates the current branch from its upstream.

Plain `git pull`: no --rebase, no --ff-only, so pull.rebase and pull.ff decide what happens, exactly as
they would in the user's own terminal. Choosing here instead would mean this panel quietly disagreeing
with the same repository's command line.

A pull can stop halfway and leave conflicts, which is not a failure to hide — the status this answers with
lists them, and the panel already has a section for them.
*/
func pull(ctx context.Context, repo *git.Repository, root string) error {
	if !hasRemote(repo) {
		return refuse("this repository has no remote to pull from")
	}

	ctx, cancel := context.WithTimeout(ctx, networkTimeout)
	defer cancel()

	return write(ctx, root, "pull")
}
