package content

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-git/go-git/v5/plumbing/format/gitignore"
)

/*
ignoreMatcherFor builds a matcher for the entries directly inside one directory. Only the .gitignore
files from the project root down to that directory can apply to them — git never consults a sibling
directory's — so this reads at most one file per level instead of walking the tree, which is what
makes it affordable on every listing and every watcher-driven re-read.

What it does not cover: .git/info/exclude, core.excludesFile, and the index (a file that is already
tracked is not ignored, whatever the patterns say).
*/
func ignoreMatcherFor(segments []string) gitignore.Matcher {
	patterns := []gitignore.Pattern{}
	for level := 0; level <= len(segments); level++ {
		patterns = append(patterns, patternsIn(segments[:level])...)
	}
	return gitignore.NewMatcher(patterns)
}

// patternsIn reads the .gitignore of one directory. A pattern's domain is where it was found, which
// is how `/dist` in a subdirectory's file stays about that subdirectory.
func patternsIn(domain []string) []gitignore.Pattern {
	osDir := GetSafePath(filepath.Join(domain...))
	if osDir == "" {
		return nil
	}

	file, err := os.Open(filepath.Join(osDir, ".gitignore"))
	if err != nil {
		// Most directories have none, which is not a problem to report.
		return nil
	}
	defer file.Close()

	patterns := []gitignore.Pattern{}
	lines := bufio.NewScanner(file)
	for lines.Scan() {
		line := strings.TrimSpace(lines.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		patterns = append(patterns, gitignore.ParsePattern(line, domain))
	}

	return patterns
}

// pathSegments splits a project-relative path the way a matcher wants it. The project root is no
// segments at all, and arrives as "", "." or "/" depending on the caller.
func pathSegments(relativePath string) []string {
	cleaned := strings.Trim(filepath.ToSlash(filepath.Clean(relativePath)), "/")
	if cleaned == "" || cleaned == "." {
		return nil
	}
	return strings.Split(cleaned, "/")
}
