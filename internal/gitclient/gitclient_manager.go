package gitclient

import (
	"errors"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// hasUnbornHead reports whether the repository has no commit yet, which several commands have to be
// told apart from an ordinary repository: HEAD names a branch that does not exist.
func hasUnbornHead(repo *git.Repository) (bool, error) {
	_, err := repo.Head()
	if err == nil {
		return false, nil
	}
	if errors.Is(err, plumbing.ErrReferenceNotFound) {
		return true, nil
	}
	return false, err
}

func getCurrentBranch(repo *git.Repository) (string, error) {
	// Get the current branch reference
	head, err := repo.Head()
	if err == nil {
		return head.Name().Short(), nil
	}

	// A repository with no commits in it has no HEAD to resolve, but HEAD still names the branch the
	// first commit will land on, which is the one `git status` reports. Reading it is what keeps a
	// freshly `git init`ed project from looking like a broken repository.
	if errors.Is(err, plumbing.ErrReferenceNotFound) {
		if unborn, refErr := repo.Reference(plumbing.HEAD, false); refErr == nil {
			return unborn.Target().Short(), nil
		}
	}
	return "", err
}

func getCommitGraph(repo *git.Repository) ([]Commit, error) {
	// Get the HEAD reference to start from the latest commit
	ref, err := repo.Head()
	if errors.Is(err, plumbing.ErrReferenceNotFound) {
		// A repository with nothing committed to it yet: an empty history rather than a failure.
		return []Commit{}, nil
	}
	if err != nil {
		return nil, err
	}

	// Traverse through the commit history
	commitIter, err := repo.Log(&git.LogOptions{From: ref.Hash()})
	if err != nil {
		return nil, err
	}

	var commits []Commit
	err = commitIter.ForEach(func(c *object.Commit) error {
		// commit data (hash, message, author, date, parents)
		parents := make([]string, len(c.ParentHashes))
		for i, parentHash := range c.ParentHashes {
			parents[i] = parentHash.String()
		}

		commit := Commit{
			Hash:    c.Hash.String(),
			Message: c.Message,
			Author:  c.Author.Name,
			Date:    c.Author.When.String(),
			Parents: parents,
		}

		commits = append(commits, commit)
		return nil
	})

	if err != nil {
		return nil, err
	}

	return commits, nil
}

// hasRemote reports whether there is anywhere to push to, which is what decides whether the panel
// offers to.
func hasRemote(repo *git.Repository) bool {
	remotes, err := repo.Remotes()
	return err == nil && len(remotes) > 0
}
