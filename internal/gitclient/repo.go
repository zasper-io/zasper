package gitclient

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-git/go-git/v5"

	"github.com/zasper-io/zasper/internal/core"
)

/*
openRepo opens the repository the project directory belongs to, and answers with it and the root of its
worktree.

DetectDotGit, because the project directory need not be the top of the checkout: Zasper opened on
`~/work/thing/notebooks` is opened on a repository whose `.git` is two levels up, and looking only at
the directory itself reported that as no repository at all. Everything else in this package takes the
root rather than reading core.Zasper, both because git paths are relative to it and so the tests can
work on a directory of their own.
*/
func openRepo() (*git.Repository, string, error) {
	repo, err := git.PlainOpenWithOptions(core.Zasper.HomeDir, &git.PlainOpenOptions{DetectDotGit: true})
	if err != nil {
		return nil, "", err
	}

	tree, err := repo.Worktree()
	if err != nil {
		// A bare repository has no worktree, so there is nothing here to show changes for.
		return nil, "", err
	}
	return repo, tree.Filesystem.Root(), nil
}

/*
relPath confines a path from a request to the repository, and answers with it relative to the root,
which is the form git wants.

content.GetSafePath is the equivalent for content requests and cannot be reused: it confines to
core.Zasper.HomeDir, and the repository root is often above that. So the check is the same one, against
a different root — resolved with EvalSymlinks so a link out of the tree cannot be followed out of it,
and compared with the separator attached, since a plain prefix test lets `../repoX-secrets` out of
`.../repoX`.
*/
func relPath(root, path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("no path was given")
	}

	absolute := path
	if !filepath.IsAbs(absolute) {
		absolute = filepath.Join(root, path)
	}
	absolute = filepath.Clean(absolute)

	// A path that does not exist yet — a deleted file — cannot be resolved, so the deepest existing
	// parent is resolved instead and the rest rejoined to it.
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	resolved := resolveExisting(absolute)

	if resolved != resolvedRoot &&
		!strings.HasPrefix(resolved, strings.TrimSuffix(resolvedRoot, string(os.PathSeparator))+string(os.PathSeparator)) {
		return "", fmt.Errorf("path %s is outside the repository", path)
	}

	relative, err := filepath.Rel(resolvedRoot, resolved)
	if err != nil {
		return "", err
	}
	// Git wants forward slashes whatever the platform, which is also what Worktree.Status answers with.
	return filepath.ToSlash(relative), nil
}

// resolveExisting resolves as much of a path as exists, so a path naming something already deleted is
// still checked against the same resolved root as everything else.
func resolveExisting(path string) string {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}

	parent := filepath.Dir(path)
	if parent == path {
		return path
	}
	return filepath.Join(resolveExisting(parent), filepath.Base(path))
}

// relPaths confines every path in a request, refusing the whole request if any one of them is out:
// a batch that silently dropped the path it did not like would stage or discard the wrong set.
func relPaths(root string, paths []string) ([]string, error) {
	relative := make([]string, 0, len(paths))
	for _, path := range paths {
		one, err := relPath(root, path)
		if err != nil {
			return nil, err
		}
		relative = append(relative, one)
	}
	if len(relative) == 0 {
		return nil, fmt.Errorf("no paths were given")
	}
	return relative, nil
}
