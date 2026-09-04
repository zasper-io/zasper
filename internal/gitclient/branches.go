package gitclient

import (
	"context"
	"sort"
	"strings"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
)

// Branch is one ref the panel can offer to switch to.
type Branch struct {
	Name    string `json:"name"`
	Current bool   `json:"current"`
	// Upstream is what this branch tracks, as `origin/main`, empty when it tracks nothing.
	Upstream string `json:"upstream,omitempty"`
	Hash     string `json:"hash,omitempty"`
	// IsRemote marks a remote-tracking ref rather than a branch of this repository. Checking one out
	// means making a local branch that follows it, which is why they are offered at all: a fresh clone
	// has one local branch and every other one is only listed here.
	IsRemote bool `json:"isRemote"`
}

/*
validBranchName rejects a name git would not take, and one git would read as a flag.

The second is the reason this is not simply left to git. The name arrives from a browser and ends up in
an argv, and `git checkout -b -f` is a checkout with an option where a branch name was meant.
check-ref-format allows a leading dash, so refusing it is this package's job.
*/
func validBranchName(name string) error {
	if name == "" {
		return refuse("a branch needs a name")
	}
	if strings.HasPrefix(name, "-") {
		return refuse("a branch name cannot begin with '-'")
	}
	if err := plumbing.NewBranchReferenceName(name).Validate(); err != nil {
		return refuse("%q is not a valid branch name", name)
	}
	return nil
}

// isRemoteOnly reports whether name is a remote-tracking ref this repository has no branch of its own
// for — `origin/topic` with no local `origin/topic`.
func isRemoteOnly(repo *git.Repository, name string) bool {
	if _, err := repo.Reference(plumbing.NewBranchReferenceName(name), false); err == nil {
		return false
	}
	_, err := repo.Reference(plumbing.ReferenceName("refs/remotes/"+name), false)
	return err == nil
}

/*
getBranches lists what can be switched to: this repository's branches, then the remote's.

The upstream is read from the configuration rather than resolved as a ref, because that is where it
lives: a branch can be set to track something that has not been fetched yet, and it still tracks it.
*/
func getBranches(repo *git.Repository) ([]Branch, error) {
	current, err := getCurrentBranch(repo)
	if err != nil {
		return nil, err
	}

	locals := []Branch{}
	iter, err := repo.Branches()
	if err != nil {
		return nil, err
	}
	err = iter.ForEach(func(ref *plumbing.Reference) error {
		name := ref.Name().Short()
		branch := Branch{Name: name, Current: name == current, Hash: ref.Hash().String()}
		if cfg, err := repo.Branch(name); err == nil && cfg.Remote != "" && cfg.Merge != "" {
			branch.Upstream = cfg.Remote + "/" + cfg.Merge.Short()
		}
		locals = append(locals, branch)
		return nil
	})
	if err != nil {
		return nil, err
	}

	remotes := []Branch{}
	refs, err := repo.References()
	if err != nil {
		return nil, err
	}
	err = refs.ForEach(func(ref *plumbing.Reference) error {
		if !ref.Name().IsRemote() {
			return nil
		}
		name := ref.Name().Short()
		// origin/HEAD is a symbolic ref naming the remote's default branch, not a branch of its own:
		// listed, it is a duplicate of whichever branch it points at.
		if strings.HasSuffix(name, "/HEAD") {
			return nil
		}
		remotes = append(remotes, Branch{Name: name, Hash: ref.Hash().String(), IsRemote: true})
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Sorted within each group and locals first, because refs come out of the store in no order the
	// user can predict and the branch they want is nearly always one of their own.
	sort.Slice(locals, func(i, j int) bool { return locals[i].Name < locals[j].Name })
	sort.Slice(remotes, func(i, j int) bool { return remotes[i].Name < remotes[j].Name })
	return append(locals, remotes...), nil
}

/*
checkout moves the worktree onto another branch, or makes one and moves onto it.

A checkout that would overwrite uncommitted work is left to git, which refuses it and names the files in
the way. That is deliberately not pre-empted with a dialog here: git's answer is both correct and
specific, where anything this package asked first would either duplicate the check or offer to throw away
changes it cannot list.
*/
func checkout(ctx context.Context, repo *git.Repository, root, branch string, create bool, from string) error {
	if err := validBranchName(branch); err != nil {
		return err
	}

	if create {
		args := []string{"checkout", "-b", branch}
		if from != "" {
			// A start point is a branch, a tag or a commit, so it is not a branch name and cannot be
			// checked as one. Only the flag case is this package's to catch; git resolves the rest and
			// says so when it cannot.
			if strings.HasPrefix(from, "-") {
				return refuse("a start point cannot begin with '-'")
			}
			args = append(args, from)
		}
		return write(ctx, root, args...)
	}

	// A name that exists only on the remote becomes a local branch following it. Plain
	// `git checkout origin/topic` leaves a detached HEAD, which is not what clicking a branch in a list
	// means, and is a state this panel has nothing to say about.
	if isRemoteOnly(repo, branch) {
		return write(ctx, root, "checkout", "--track", branch)
	}
	return write(ctx, root, "checkout", branch)
}

/*
deleteBranch removes a local branch.

Local only. `git branch -dr origin/topic` deletes the remote-tracking ref and leaves the branch on the
server, and a delete that silently means half of what it says is not worth offering — so a remote name is
refused rather than half-honoured. Deleting the current branch, or one whose commits are nowhere else, is
refused by git itself; force is the caller saying it meant the second.
*/
func deleteBranch(ctx context.Context, repo *git.Repository, root, name string, force bool) error {
	if err := validBranchName(name); err != nil {
		return err
	}
	if isRemoteOnly(repo, name) {
		return refuse("%s is on the remote, and deleting it from here would only remove the local copy of it", name)
	}

	flag := "-d"
	if force {
		flag = "-D"
	}
	return write(ctx, root, "branch", flag, name)
}
