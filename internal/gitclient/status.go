package gitclient

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/format/index"
)

// FileChange is one path that differs from HEAD, and how it differs on each side of the index.
type FileChange struct {
	Path string `json:"path"`
	// Staged and Worktree are git's own one-letter codes — M, A, D, R, C, ?, U — or empty where that
	// side is unmodified. Empty rather than a space, so the frontend can test them for truth.
	Staged   string `json:"staged"`
	Worktree string `json:"worktree"`
	// From is where a rename came from.
	From string `json:"from,omitempty"`
}

/*
StatusResponse is everything the source control panel needs to draw itself once.

The lists are separate because staging is the whole point of the panel and the previous single list of
names could not express it: a file staged and then edited again belongs in both Staged and Unstaged,
which is what git reports and what the user has to be able to see before committing.
*/
type StatusResponse struct {
	IsRepository bool `json:"isRepository"`
	// GitAvailable is false on a machine with no git binary, where the panel can still show what has
	// changed but cannot change anything.
	GitAvailable bool   `json:"gitAvailable"`
	Branch       string `json:"branch"`
	Upstream     string `json:"upstream"`
	Ahead        int    `json:"ahead"`
	Behind       int    `json:"behind"`
	HasRemote    bool   `json:"hasRemote"`

	Staged     []FileChange `json:"staged"`
	Unstaged   []FileChange `json:"unstaged"`
	Untracked  []FileChange `json:"untracked"`
	Conflicted []FileChange `json:"conflicted"`
}

/*
newStatus is the state of a project nothing is known about yet.

The four lists are empty rather than nil so that a repository with nothing to report answers with `[]`
and not `null`: the panel counts all four on every render, and a null is a crash rather than a quiet
section.
*/
func newStatus() StatusResponse {
	return StatusResponse{
		GitAvailable: Available(),
		Staged:       []FileChange{},
		Unstaged:     []FileChange{},
		Untracked:    []FileChange{},
		Conflicted:   []FileChange{},
	}
}

// code is git's letter for a status, or empty where there is nothing to report.
func code(c git.StatusCode) string {
	if c == git.Unmodified {
		return ""
	}
	return string(rune(c))
}

/*
conflictedPaths answers the paths in the middle of a merge.

Read from the index rather than from Status, which never reports UpdatedButUnmerged: go-git computes a
status by diffing HEAD against the index against the worktree, and a conflicted path comes out of that
looking like an ordinary modification. What actually marks one is the index holding it more than once,
at stage 2 (ours) and stage 3 (theirs).
*/
func conflictedPaths(repo *git.Repository) (map[string]bool, error) {
	idx, err := repo.Storer.Index()
	if err != nil {
		return nil, err
	}

	conflicted := map[string]bool{}
	for _, entry := range idx.Entries {
		if entry.Stage == index.OurMode || entry.Stage == index.TheirMode {
			conflicted[entry.Name] = true
		}
	}
	return conflicted, nil
}

/*
stagedDeletions answers which of paths HEAD still holds and the index no longer does.

Needed because go-git's status cannot express one: `git rm --cached` leaves a file staged for deletion
and untracked on disk, and Status reports only the untracked half — its Status.File creates an entry with
both sides marked untracked, and the staging diff never corrects it. git's own short status prints two
lines for this, D and ??, and the D is the half that would otherwise be committed with nothing on screen
saying so.

Only the paths already known to be untracked are looked up, so this is a handful of tree lookups rather
than a second walk.
*/
func stagedDeletions(repo *git.Repository, paths []string) (map[string]bool, error) {
	deleted := map[string]bool{}
	if len(paths) == 0 {
		return deleted, nil
	}

	head, err := repo.Head()
	if err != nil {
		// Nothing is committed, so nothing can have been deleted from a commit.
		if errors.Is(err, plumbing.ErrReferenceNotFound) {
			return deleted, nil
		}
		return nil, err
	}
	commit, err := repo.CommitObject(head.Hash())
	if err != nil {
		return nil, err
	}
	tree, err := commit.Tree()
	if err != nil {
		return nil, err
	}
	idx, err := repo.Storer.Index()
	if err != nil {
		return nil, err
	}

	for _, path := range paths {
		if _, err := idx.Entry(path); err == nil {
			continue
		}
		if _, err := tree.FindEntry(path); err == nil {
			deleted[path] = true
		}
	}
	return deleted, nil
}

/*
stagedRenames collapses a staged deletion and a staged addition of the same content into one rename.

go-git never reports one. Its status diffs HEAD's tree against the index path by path, so `git mv` arrives
here as a D and an A that happen to hold the same blob, where git's own status prints a single R with both
names — and the panel would otherwise show a file the user still has as deleted.

Only exact renames are found, by comparing the two hashes. A file moved and edited in one step stays two
rows, which is what git falls back to when its own similarity score is not met, and is not wrong about
anything: both paths are listed and both can be staged.

Runs on the sorted list so that two deleted files with identical content pair with the additions in a
fixed order rather than whichever way the status map was walked.
*/
func stagedRenames(repo *git.Repository, staged []FileChange) ([]FileChange, error) {
	// A path deleted from the index but still on disk is not a rename source, whatever a new file happens
	// to contain: `git rm --cached` leaves the file exactly where it was.
	isSource := func(change FileChange) bool { return change.Staged == "D" && change.Worktree != "?" }

	var additions, deletions int
	for _, change := range staged {
		if change.Staged == "A" {
			additions++
		} else if isSource(change) {
			deletions++
		}
	}
	if additions == 0 || deletions == 0 {
		return staged, nil
	}

	head, err := repo.Head()
	if err != nil {
		// Nothing is committed, so nothing has been renamed: an addition is just an addition.
		if errors.Is(err, plumbing.ErrReferenceNotFound) {
			return staged, nil
		}
		return nil, err
	}
	commit, err := repo.CommitObject(head.Hash())
	if err != nil {
		return nil, err
	}
	tree, err := commit.Tree()
	if err != nil {
		return nil, err
	}
	idx, err := repo.Storer.Index()
	if err != nil {
		return nil, err
	}

	// What HEAD held at each deleted path, so an addition can be recognised as the same content.
	sources := map[plumbing.Hash][]string{}
	for _, change := range staged {
		if !isSource(change) {
			continue
		}
		entry, err := tree.FindEntry(change.Path)
		if err != nil {
			continue
		}
		sources[entry.Hash] = append(sources[entry.Hash], change.Path)
	}

	renamed := map[string]bool{}
	collapsed := make([]FileChange, 0, len(staged))
	for _, change := range staged {
		if change.Staged == "A" {
			entry, err := idx.Entry(change.Path)
			if err == nil && len(sources[entry.Hash]) > 0 {
				from := sources[entry.Hash][0]
				sources[entry.Hash] = sources[entry.Hash][1:]
				renamed[from] = true
				change.Staged = "R"
				change.From = from
			}
		}
		collapsed = append(collapsed, change)
	}

	// Second pass, because a deletion can be sorted before or after the addition that claims it.
	kept := make([]FileChange, 0, len(collapsed))
	for _, change := range collapsed {
		if change.Staged == "D" && renamed[change.Path] {
			continue
		}
		kept = append(kept, change)
	}
	return kept, nil
}

/*
getStatus collects what has changed, grouped the way the panel shows it.

The Preload strategy, rather than the default: go-git's own documentation says the default one can report
an unmodified file as untracked (its issue #119), which in a source control panel means offering to add
a file that is already committed. It costs a walk of the index, which is the price of the answer being
right.
*/
func getStatus(repo *git.Repository) (StatusResponse, error) {
	response := newStatus()
	response.IsRepository = true

	tree, err := repo.Worktree()
	if err != nil {
		return response, err
	}

	status, err := tree.StatusWithOptions(git.StatusOptions{Strategy: git.Preload})
	if err != nil {
		return response, err
	}

	conflicted, err := conflictedPaths(repo)
	if err != nil {
		return response, err
	}

	for path, state := range status {
		if state.Staging == git.Unmodified && state.Worktree == git.Unmodified {
			continue
		}

		change := FileChange{
			Path:     path,
			Staged:   code(state.Staging),
			Worktree: code(state.Worktree),
			From:     state.Extra,
		}

		switch {
		case conflicted[path]:
			change.Staged, change.Worktree = "U", "U"
			response.Conflicted = append(response.Conflicted, change)
		case state.Worktree == git.Untracked:
			// go-git marks both sides of an untracked file, but there is nothing staged about a file
			// git has never heard of.
			change.Staged = ""
			response.Untracked = append(response.Untracked, change)
		default:
			if state.Staging != git.Unmodified {
				response.Staged = append(response.Staged, change)
			}
			if state.Worktree != git.Unmodified {
				response.Unstaged = append(response.Unstaged, change)
			}
		}
	}

	untrackedPaths := make([]string, 0, len(response.Untracked))
	for _, change := range response.Untracked {
		untrackedPaths = append(untrackedPaths, change.Path)
	}
	deleted, err := stagedDeletions(repo, untrackedPaths)
	if err != nil {
		return response, err
	}
	for path := range deleted {
		response.Staged = append(response.Staged, FileChange{Path: path, Staged: "D", Worktree: "?"})
	}

	// Sorted, because a status is a map: unsorted, the panel reordered itself on every refresh.
	for _, list := range [][]FileChange{
		response.Staged, response.Unstaged, response.Untracked, response.Conflicted,
	} {
		sort.Slice(list, func(i, j int) bool { return list[i].Path < list[j].Path })
	}

	// Assigned only on success, so a failure here leaves the list it was given rather than a null.
	collapsed, err := stagedRenames(repo, response.Staged)
	if err != nil {
		return response, err
	}
	response.Staged = collapsed

	return response, nil
}

/*
syncState answers the upstream branch and how far ahead and behind of it the current branch is.

git rather than go-git, for once on a read: counting the two sides of a symmetric difference means
walking both histories until their frontiers meet, and rev-list already does that — where doing it here
would either walk the whole history or be wrong about merges. A branch with no upstream is not a
failure, so a failure here is reported as no upstream.
*/
func syncState(ctx context.Context, root string) (upstream string, ahead, behind int) {
	if !Available() {
		return "", 0, 0
	}

	upstream, err := run(ctx, root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if err != nil {
		return "", 0, 0
	}

	counts, err := run(ctx, root, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")
	if err != nil {
		return upstream, 0, 0
	}

	fields := strings.Fields(counts)
	if len(fields) != 2 {
		return upstream, 0, 0
	}
	ahead, _ = strconv.Atoi(fields[0])
	behind, _ = strconv.Atoi(fields[1])
	return upstream, ahead, behind
}

// stage adds paths to the index, which is `git add` and nothing else. A directory is staged whole,
// which is what selecting a folder in the panel means.
func stage(ctx context.Context, root string, paths []string) error {
	return write(ctx, root, pathArgs([]string{"add"}, paths)...)
}

/*
unstage takes paths back out of the index.

Two commands, because a repository with no commit yet has no HEAD to restore from: `git restore --staged`
and `git reset` both fail there with "Failed to resolve 'HEAD'", and removing the entry from the index is
what unstaging means when there is nothing behind it. This is the state a project is in between
`git init` and its first commit, so it is not an edge case for a new project.
*/
func unstage(ctx context.Context, repo *git.Repository, root string, paths []string) error {
	if unborn, err := hasUnbornHead(repo); err != nil {
		return err
	} else if unborn {
		return write(ctx, root, pathArgs([]string{"rm", "--cached", "-r", "--quiet"}, paths)...)
	}
	return write(ctx, root, pathArgs([]string{"restore", "--staged"}, paths)...)
}

/*
discard throws away changes to paths, and says so plainly when that means deleting a file.

An untracked file has no version to restore, so discarding it is a delete with no undo — git does it
with a different command for the same reason. Rather than guess, a request naming one is refused unless
it says it means to delete, which is what the dialog in the panel is for.
*/
func discard(ctx context.Context, repo *git.Repository, root string, paths []string, deleteUntracked bool) error {
	tree, err := repo.Worktree()
	if err != nil {
		return err
	}
	status, err := tree.StatusWithOptions(git.StatusOptions{Strategy: git.Preload})
	if err != nil {
		return err
	}

	var tracked, untracked []string
	for _, path := range paths {
		if state, ok := status[path]; ok && state.Worktree == git.Untracked {
			untracked = append(untracked, path)
			continue
		}
		tracked = append(tracked, path)
	}

	if len(untracked) > 0 && !deleteUntracked {
		return refuse("%s is not tracked, so discarding it would delete it", untracked[0])
	}

	if len(tracked) > 0 {
		if err := write(ctx, root, pathArgs([]string{"restore", "--worktree"}, tracked)...); err != nil {
			return err
		}
	}
	if len(untracked) > 0 {
		// -d as well as -f: an untracked directory is one entry in the panel and several on disk.
		if err := write(ctx, root, pathArgs([]string{"clean", "-fdq"}, untracked)...); err != nil {
			return err
		}
	}
	return nil
}

/*
commitStaged commits what is in the index, and only that.

Only that is the fix: this used to add the files it was given and then commit with All, which committed
every modified tracked file in the repository. Ticking one file of five committed five, and the ticks
were the only thing suggesting otherwise.
*/
func commitStaged(ctx context.Context, root, message string, amend bool) error {
	args := []string{"commit", "-m", message}
	if amend {
		args = append(args, "--amend")
	}
	return write(ctx, root, args...)
}
