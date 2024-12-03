package gitclient

import (
	"fmt"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"
)

func getCurrentBranch(repoPath string) (string, error) {
	// Open the current Git repository (use the path to your repo)
	repo, err := git.PlainOpen(repoPath) // The "." means it will open the Git repo from the current directory
	if err != nil {
		return "", err
	}

	// Get the current branch reference
	head, err := repo.Head()
	if err != nil {
		return "", err
	}

	// Return the name of the branch
	return head.Name().Short(), nil
}

func getCommitGraph(repoPath string) ([]Commit, error) {
	// Open existing git repository
	repo, err := git.PlainOpen(repoPath)
	if err != nil {
		return nil, err
	}

	// Get the HEAD reference to start from the latest commit
	ref, err := repo.Head()
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

// Function to get a list of uncommitted files
func getUncommittedFiles(repoPath string) ([]string, error) {
	// Open the git repository
	repo, err := git.PlainOpen(repoPath)
	if err != nil {
		return nil, err
	}

	// Get the current working tree
	w, err := repo.Worktree()
	if err != nil {
		return nil, err
	}

	// Get the status of the files in the repository
	status, err := w.Status()
	if err != nil {
		return nil, err
	}

	// Collect the list of modified or untracked files
	var uncommittedFiles []string
	for file, state := range status {
		if state.Worktree != git.Unmodified { // Filter out unmodified files
			uncommittedFiles = append(uncommittedFiles, file)
		}
	}

	return uncommittedFiles, nil
}

// Function to commit specific files
func commitSpecificFiles(repoPath string, files []string, message string) error {
	// Open the git repository
	repo, err := git.PlainOpen(repoPath)
	if err != nil {
		return err
	}

	// Get the current working tree
	w, err := repo.Worktree()
	if err != nil {
		return err
	}

	// Add the selected files
	for _, file := range files {
		_, err = w.Add(file)
		if err != nil {
			return fmt.Errorf("failed to add file %s: %v", file, err)
		}
	}

	// Commit the changes
	_, err = w.Commit(message, &git.CommitOptions{
		All: true,
	})
	if err != nil {
		return err
	}

	return nil
}

// Function to push changes to remote
func pushChanges(repoPath string) error {
	// Open the git repository
	repo, err := git.PlainOpen(repoPath)
	if err != nil {
		return err
	}

	// Get the remote (assuming "origin" as the remote name)
	remote, err := repo.Remote("origin")
	if err != nil {
		return fmt.Errorf("failed to get remote: %v", err)
	}

	// Push changes to the remote repository
	err = remote.Push(&git.PushOptions{})
	if err != nil {
		return fmt.Errorf("failed to push changes: %v", err)
	}

	return nil
}
