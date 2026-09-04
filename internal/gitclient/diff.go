package gitclient

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/format/index"
	"github.com/go-git/go-git/v5/plumbing/object"

	"github.com/zasper-io/zasper/internal/nbformat"
)

/*
DiffResponse is the two sides of a comparison, not a patch.

Two whole documents because the viewer is a CodeMirror MergeView, which computes the difference itself
and needs both texts to do it — a unified patch would have to be parsed back into two documents before
anything could be drawn from it. It also means a diff and the editor beside it are showing the same
kind of thing, which a patch is not.

An absent side is an empty document: a file that was added has no original, and one that was deleted
has no modified version. That is what makes those read as all-additions and all-deletions without a
flag for either.
*/
type DiffResponse struct {
	Path string `json:"path"`
	// From is the other name a rename had, so the viewer can say the file moved.
	From     string `json:"from,omitempty"`
	Original string `json:"original"`
	Modified string `json:"modified"`
	// IsBinary says the documents are empty because there was nothing to show, not because the file is:
	// two columns of NUL bytes are not a diff anybody can read.
	IsBinary bool `json:"isBinary"`
	// IsNotebook says both sides are cell sources rather than the file itself, so the viewer can say so
	// rather than letting someone read a diff of half a notebook as the whole of it.
	IsNotebook bool `json:"isNotebook"`
	// TooLarge is the same for a file this refuses to send: honest about why it is empty.
	TooLarge bool `json:"tooLarge"`
}

const (
	/*
		The most one side of a comparison may be.

		Both sides are held in memory here, encoded into a JSON response, and then handed to a diff
		algorithm in a browser tab — so a 200MB CSV is not a diff that fails to be useful, it is a tab that
		stops responding and a server that allocated half a gigabyte to make that happen.
	*/
	maxDiffBytes = 2 << 20
	// git's own test for a binary file is a NUL byte in the first few thousand bytes, which is what
	// makes it a heuristic rather than an inspection.
	binarySniffBytes = 8000
	// The extension is all there is to go on: nothing else in a tree says a blob is a notebook.
	notebookExtension = ".ipynb"
)

/*
missingPath is a path neither side of a comparison has.

The ordinary way to get one is a stale panel: a file discarded or committed in a terminal while its row
was still on screen. Not a fault, and not an empty diff either — an empty diff of nothing looks exactly
like a file that has not changed, which is a worse answer than saying it is not there.
*/
type missingPath struct {
	path string
}

func (e *missingPath) Error() string {
	return fmt.Sprintf("%q is on neither side of this comparison", e.path)
}

/*
getDiff answers the two sides of one file's comparison.

Which two sides depends on what was asked for, and the three cases are the three questions a panel asks:

  - ref names a commit: that commit against its first parent, which is what `git show` compares and what
    a file clicked in the history means.
  - staged: HEAD against the index — what a commit would record.
  - neither: the index against the file on disk — what a commit would leave behind.

from is the other name of a renamed file, and is the path used on the original side when it is given.
Without it a rename reads as a whole file added and nothing deleted, since the old name is the only name
the original side has.
*/
func getDiff(repo *git.Repository, root, path, from string, staged bool, ref string) (DiffResponse, error) {
	originalPath := path
	if from != "" {
		originalPath = from
	}

	var original, modified []byte
	var haveOriginal, haveModified bool
	var err error

	switch {
	case ref != "":
		commit, resolveErr := commitFor(repo, ref)
		if resolveErr != nil {
			return DiffResponse{}, resolveErr
		}

		to, treeErr := commit.Tree()
		if treeErr != nil {
			return DiffResponse{}, treeErr
		}
		// A root commit is compared against nothing, which makes every file in it an addition — the same
		// thing git says about one.
		var parentTree *object.Tree
		if commit.NumParents() > 0 {
			parent, parentErr := commit.Parent(0)
			if parentErr != nil {
				return DiffResponse{}, parentErr
			}
			if parentTree, parentErr = parent.Tree(); parentErr != nil {
				return DiffResponse{}, parentErr
			}
		}

		if original, haveOriginal, err = treeContent(repo, parentTree, originalPath); err != nil {
			return DiffResponse{}, err
		}
		modified, haveModified, err = treeContent(repo, to, path)

	case staged:
		if original, haveOriginal, err = headContent(repo, originalPath); err != nil {
			return DiffResponse{}, err
		}
		modified, haveModified, err = indexContent(repo, path)

	default:
		if original, haveOriginal, err = indexContent(repo, originalPath); err != nil {
			return DiffResponse{}, err
		}
		modified, haveModified, err = worktreeContent(root, path)
	}
	if err != nil {
		return DiffResponse{}, err
	}
	if !haveOriginal && !haveModified {
		return DiffResponse{}, &missingPath{path: path}
	}

	response := DiffResponse{Path: path}
	if from != "" {
		response.From = from
	}

	switch {
	case len(original) > maxDiffBytes || len(modified) > maxDiffBytes:
		response.TooLarge = true
	case isBinary(original) || isBinary(modified):
		response.IsBinary = true
	default:
		if strings.EqualFold(filepath.Ext(path), notebookExtension) {
			if left, right, ok := notebookSides(original, modified); ok {
				response.IsNotebook = true
				response.Original, response.Modified = left, right
				return response, nil
			}
			// Not a notebook this can read — a merge conflict left in the JSON, or a file with the
			// extension and nothing else — so it is compared as the text it is.
		}
		response.Original, response.Modified = string(original), string(modified)
	}
	return response, nil
}

// headContent is what the last commit holds at path, absent when nothing is committed yet.
func headContent(repo *git.Repository, path string) ([]byte, bool, error) {
	head, err := repo.Head()
	if errors.Is(err, plumbing.ErrReferenceNotFound) {
		// Between `git init` and the first commit everything staged is an addition, and this is the side
		// there is nothing on.
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	commit, err := repo.CommitObject(head.Hash())
	if err != nil {
		return nil, false, err
	}
	tree, err := commit.Tree()
	if err != nil {
		return nil, false, err
	}
	return treeContent(repo, tree, path)
}

// treeContent is what a tree holds at path. A nil tree is the empty tree, and a path a tree does not
// have is absent rather than a failure: that is how an addition and a deletion arrive here.
func treeContent(repo *git.Repository, tree *object.Tree, path string) ([]byte, bool, error) {
	if tree == nil {
		return nil, false, nil
	}

	entry, err := tree.FindEntry(path)
	if errors.Is(err, object.ErrEntryNotFound) || errors.Is(err, object.ErrDirectoryNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if !entry.Mode.IsFile() {
		// A submodule or a directory: there is no blob to read, and a diff of a gitlink is a diff of one
		// hash against another, which says nothing.
		return nil, false, nil
	}
	return blobContent(repo, entry.Hash)
}

/*
indexContent is what is staged at path.

The entries are walked rather than looked up, because a path in the middle of a merge is in the index
three times — base, ours and theirs — and go-git's own Entry answers with whichever comes first, which is
the base. Ours is the side to show: it is the version the worktree's conflict markers were written around.

Which entry is which is decided by preferring stage 2 and not by recognising an unconflicted one, because
there is no constant for that here: git writes stage 0 for a merged entry, while go-git's `Merged` is
declared as 1 — the number git uses for a merge base.
*/
func indexContent(repo *git.Repository, path string) ([]byte, bool, error) {
	idx, err := repo.Storer.Index()
	if err != nil {
		return nil, false, err
	}

	var chosen *index.Entry
	for _, entry := range idx.Entries {
		if entry.Name != path {
			continue
		}
		if chosen == nil || entry.Stage == index.OurMode {
			chosen = entry
		}
	}
	if chosen == nil {
		// Untracked, or staged for deletion: either way the index has nothing to show.
		return nil, false, nil
	}
	return blobContent(repo, chosen.Hash)
}

// worktreeContent is the file on disk, absent when it has been deleted.
func worktreeContent(root, path string) ([]byte, bool, error) {
	file, err := os.Open(filepath.Join(root, filepath.FromSlash(path)))
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	defer file.Close()

	data, err := readCapped(file)
	if err != nil {
		return nil, false, err
	}
	return data, true, nil
}

func blobContent(repo *git.Repository, hash plumbing.Hash) ([]byte, bool, error) {
	blob, err := repo.BlobObject(hash)
	if err != nil {
		return nil, false, err
	}

	reader, err := blob.Reader()
	if err != nil {
		return nil, false, err
	}
	defer reader.Close()

	data, err := readCapped(reader)
	if err != nil {
		return nil, false, err
	}
	return data, true, nil
}

// readCapped reads one byte more than the limit, so the caller can tell a file at the limit from one
// over it without holding the whole of the second kind.
func readCapped(reader io.Reader) ([]byte, error) {
	return io.ReadAll(io.LimitReader(reader, maxDiffBytes+1))
}

// isBinary is git's own heuristic: a NUL byte near the start of the file.
func isBinary(data []byte) bool {
	head := data
	if len(head) > binarySniffBytes {
		head = head[:binarySniffBytes]
	}
	return bytes.IndexByte(head, 0) >= 0
}

/*
notebookSides renders both sides of a notebook comparison as cell sources, or reports that it cannot.

Both or neither: a comparison with one side rendered as cells and the other as raw JSON is every line of
the file changed, which is a worse answer than the raw JSON on both sides.
*/
func notebookSides(original, modified []byte) (string, string, bool) {
	left, leftOK := notebookCells(original)
	right, rightOK := notebookCells(modified)
	if !leftOK || !rightOK {
		return "", "", false
	}
	return left, right, true
}

/*
notebookCells renders a notebook as the source of its cells and nothing else.

Outputs, execution counts and metadata are left out. A raw .ipynb comparison is base64 image data,
`execution_count` renumbered by every run, and cell ids — so running a notebook twice and changing
nothing shows as a changed file, and changing one line shows as a changed line somewhere inside a
document nobody can find their place in. What a person wants to see is the code they wrote.

The markers carry the cell number and its type, in the `# %%` form Jupytext and VS Code use, so they
read as comments in the language the cells are mostly written in.
*/
func notebookCells(data []byte) (string, bool) {
	// An absent side — an added or deleted notebook — renders as an empty document rather than failing,
	// which is what makes it a whole addition or deletion rather than a raw-JSON comparison.
	if len(bytes.TrimSpace(data)) == 0 {
		return "", true
	}

	doc, err := nbformat.Read(data)
	if err != nil {
		return "", false
	}

	var out strings.Builder
	for i, cell := range doc.Cells() {
		kind, _ := cell["cell_type"].(string)
		if kind == "" {
			kind = "unknown"
		}
		if i > 0 {
			out.WriteString("\n")
		}
		fmt.Fprintf(&out, "# %%%% [%d] %s\n", i+1, kind)

		// A source that is not a string is one nbformat could not join, so there is no text in it to show.
		source, _ := cell["source"].(string)
		out.WriteString(source)
		if !strings.HasSuffix(source, "\n") {
			out.WriteString("\n")
		}
	}
	return out.String(), true
}
