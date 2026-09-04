package gitclient

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	fdiff "github.com/go-git/go-git/v5/plumbing/format/diff"
	"github.com/go-git/go-git/v5/plumbing/object"
)

/*
Commit is one entry of the history.

The subject and the body are separate because the panel shows one line per commit and git's own
convention is that the first line is that line. Sending the whole message and cutting it in the browser
is what the old panel did, which put "Merge branch 'main' of github.com:..." and the twelve lines of
conflict notes under it into a 200px-wide row.

Date is RFC 3339 rather than Go's time.Time.String(), which is not a format any JavaScript Date can
parse — so the old history could not say when anything happened, and did not try.
*/
type Commit struct {
	Hash      string   `json:"hash"`
	ShortHash string   `json:"shortHash"`
	Subject   string   `json:"subject"`
	Body      string   `json:"body,omitempty"`
	Author    string   `json:"author"`
	Email     string   `json:"email,omitempty"`
	Date      string   `json:"date"`
	Parents   []string `json:"parents"`
}

// One file of a commit, with what happened to it.
type CommitFile struct {
	Path string `json:"path"`
	// From is where a rename came from, absent for everything else.
	From string `json:"from,omitempty"`
	// Status is git's letter: A, M, D or R.
	Status     string `json:"status"`
	Insertions int    `json:"insertions"`
	Deletions  int    `json:"deletions"`
	// IsBinary says the counts are meaningless rather than zero: git counts no lines in a PNG.
	IsBinary bool `json:"isBinary"`
}

// CommitDetail is one commit and what it changed.
type CommitDetail struct {
	Commit
	Files      []CommitFile `json:"files"`
	Insertions int          `json:"insertions"`
	Deletions  int          `json:"deletions"`
	// Truncated says the file list was cut, so the panel can say so rather than quietly showing part of
	// a commit as all of it.
	Truncated bool `json:"truncated"`
}

const (
	// git's own default abbreviation, which is what people paste into a terminal.
	shortHashLength = 7
	// How many commits a page holds when the caller does not say, and the most it may ask for. The old
	// history walked to the root commit on every read, so a repository with 40,000 commits sent all of
	// them to a panel that draws thirty.
	defaultLogLimit = 50
	maxLogLimit     = 500
	/*
		How many files of one commit are described.

		Each one costs a content diff of both its blobs, so an import commit of 20,000 files would be a
		request that reads the whole tree twice to fill a list nobody scrolls. What is over the limit is
		reported as truncated.
	*/
	maxCommitFiles = 500
)

func shortHash(hash plumbing.Hash) string {
	return hash.String()[:shortHashLength]
}

func toCommit(c *object.Commit) Commit {
	parents := make([]string, 0, len(c.ParentHashes))
	for _, parent := range c.ParentHashes {
		parents = append(parents, parent.String())
	}

	subject, body := splitMessage(c.Message)
	return Commit{
		Hash:      c.Hash.String(),
		ShortHash: shortHash(c.Hash),
		Subject:   subject,
		Body:      body,
		Author:    c.Author.Name,
		Email:     c.Author.Email,
		Date:      c.Author.When.Format(time.RFC3339),
		Parents:   parents,
	}
}

// splitMessage divides a commit message the way git does: the first line, then whatever is under the
// blank line after it.
func splitMessage(message string) (subject, body string) {
	subject, body, _ = strings.Cut(strings.TrimSpace(message), "\n")
	return strings.TrimSpace(subject), strings.TrimSpace(body)
}

/*
getLog answers one page of the history, and whether there is another after it.

Paged by walking, because that is all go-git offers: there is no way to start a log at an offset, so
skip is that many Next calls. It is still cheaper than the alternative the panel had — the whole history,
every time anything was committed.
*/
func getLog(repo *git.Repository, limit, skip int) ([]Commit, bool, error) {
	head, err := repo.Head()
	if errors.Is(err, plumbing.ErrReferenceNotFound) {
		// Nothing committed yet: an empty history rather than a failure. This is every project between
		// `git init` and its first commit.
		return []Commit{}, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	walk, err := repo.Log(&git.LogOptions{From: head.Hash()})
	if err != nil {
		return nil, false, err
	}
	defer walk.Close()

	for i := 0; i < skip; i++ {
		if _, err := walk.Next(); err != nil {
			if errors.Is(err, io.EOF) {
				return []Commit{}, false, nil
			}
			return nil, false, err
		}
	}

	commits := make([]Commit, 0, limit)
	for len(commits) < limit {
		commit, err := walk.Next()
		if errors.Is(err, io.EOF) {
			return commits, false, nil
		}
		if err != nil {
			return nil, false, err
		}
		commits = append(commits, toCommit(commit))
	}

	// One past the page, to say whether the panel should offer more. Cheaper than counting the history,
	// which is the question nobody asked.
	_, err = walk.Next()
	if errors.Is(err, io.EOF) {
		return commits, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return commits, true, nil
}

/*
getCommitDetail is one commit and the files in it.

Diffed against the first parent, which is what `git show` does: a merge against all of its parents shows
only the conflicts that had to be resolved by hand, and a merge that resolved nothing shows nothing at
all — neither of which is what someone clicking a merge in a list wants to see.
*/
func getCommitDetail(ctx context.Context, repo *git.Repository, revision string) (CommitDetail, error) {
	commit, err := commitFor(repo, revision)
	if err != nil {
		return CommitDetail{}, err
	}

	detail := CommitDetail{Commit: toCommit(commit), Files: []CommitFile{}}

	to, err := commit.Tree()
	if err != nil {
		return detail, err
	}

	// A root commit has no parent to diff against, so it is diffed against nothing — which go-git reads
	// as an empty tree, making every file in it an addition. That is what git says about one too.
	var from *object.Tree
	if commit.NumParents() > 0 {
		parent, err := commit.Parent(0)
		if err != nil {
			return detail, err
		}
		if from, err = parent.Tree(); err != nil {
			return detail, err
		}
	}

	changes, err := object.DiffTreeWithOptions(ctx, from, to, object.DefaultDiffTreeOptions)
	if err != nil {
		return detail, err
	}
	sort.Sort(changes)

	if len(changes) > maxCommitFiles {
		changes = changes[:maxCommitFiles]
		detail.Truncated = true
	}

	patch, err := changes.PatchContext(ctx)
	if err != nil {
		return detail, err
	}

	for _, filePatch := range patch.FilePatches() {
		file := describe(filePatch)
		detail.Insertions += file.Insertions
		detail.Deletions += file.Deletions
		detail.Files = append(detail.Files, file)
	}
	return detail, nil
}

// commitFor resolves what the request named. A revision rather than a hash, so HEAD, a branch name and
// an abbreviated hash all work — the panel sends full hashes, and a person typing one into a URL does not.
func commitFor(repo *git.Repository, revision string) (*object.Commit, error) {
	if strings.TrimSpace(revision) == "" {
		return nil, &notFound{what: revision}
	}

	hash, err := repo.ResolveRevision(plumbing.Revision(revision))
	if err != nil {
		return nil, &notFound{what: revision}
	}
	commit, err := repo.CommitObject(*hash)
	if err != nil {
		return nil, &notFound{what: revision}
	}
	return commit, nil
}

// notFound is a revision this repository does not have, which is the caller's mistake and not a fault:
// a stale panel asking about a commit that has since been rebased away is the ordinary way to get one.
type notFound struct {
	what string
}

func (e *notFound) Error() string {
	return fmt.Sprintf("%q is not a commit in this repository", e.what)
}

// describe reads one file's patch: what happened to it, and how much.
func describe(filePatch fdiff.FilePatch) CommitFile {
	from, to := filePatch.Files()
	file := CommitFile{IsBinary: filePatch.IsBinary()}

	switch {
	case from == nil:
		file.Status, file.Path = "A", to.Path()
	case to == nil:
		file.Status, file.Path = "D", from.Path()
	case from.Path() != to.Path():
		file.Status, file.Path, file.From = "R", to.Path(), from.Path()
	default:
		file.Status, file.Path = "M", to.Path()
	}

	for _, chunk := range filePatch.Chunks() {
		content := chunk.Content()
		if content == "" {
			continue
		}
		// A chunk is a run of lines, and the last of them need not be terminated — the counting go-git
		// does for its own stats, which cannot be reused here because it drops binary files from the list
		// and this panel shows them.
		lines := strings.Count(content, "\n")
		if content[len(content)-1] != '\n' {
			lines++
		}
		switch chunk.Type() {
		case fdiff.Add:
			file.Insertions += lines
		case fdiff.Delete:
			file.Deletions += lines
		}
	}
	return file
}
