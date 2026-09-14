package content

import (
	"bufio"
	"os"
	"path/filepath"
	"slices"
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
func (p Project) ignoreMatcherFor(segments []string) gitignore.Matcher {
	patterns := []gitignore.Pattern{}
	for level := 0; level <= len(segments); level++ {
		patterns = append(patterns, p.patternsIn(segments[:level])...)
	}
	return gitignore.NewMatcher(patterns)
}

// patternsIn reads the .gitignore of one directory. A pattern's domain is where it was found, which
// is how `/dist` in a subdirectory's file stays about that subdirectory.
func (p Project) patternsIn(domain []string) []gitignore.Pattern {
	osDir := p.SafePath(filepath.Join(domain...))
	if osDir == "" {
		return nil
	}
	return patternsInDir(osDir, domain)
}

// patternsInDir is patternsIn for a caller that already has the directory's OS path.
func patternsInDir(osDir string, domain []string) []gitignore.Pattern {
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

// alwaysSkipped are folders nobody edits by hand, each holding more folders than are worth walking.
var alwaysSkipped = map[string]bool{
	".git": true, "node_modules": true, "__pycache__": true, ".ipynb_checkpoints": true, ".venv": true,
}

/*
ProjectIgnores answers whether a path under a project is left out of what Zasper watches and searches:
the folders in alwaysSkipped, and whatever the project's .gitignore files ignore. It reads each .gitignore
once and remembers it, so one is made per walk.
*/
type ProjectIgnores struct {
	root     string
	patterns map[string][]gitignore.Pattern
}

func NewProjectIgnores(root string) *ProjectIgnores {
	return &ProjectIgnores{root: root, patterns: map[string][]gitignore.Pattern{}}
}

// Skips reports whether the folder or file at osPath is left out.
func (p *ProjectIgnores) Skips(osPath string, isDir bool) bool {
	if isDir && alwaysSkipped[filepath.Base(osPath)] {
		return true
	}
	relative, err := filepath.Rel(p.root, osPath)
	if err != nil {
		return false
	}
	segments := pathSegments(relative)
	if len(segments) == 0 {
		return false
	}
	return gitignore.NewMatcher(p.patternsFor(segments[:len(segments)-1])).Match(segments, isDir)
}

// patternsFor answers every pattern that applies to the entries of the folder at segments: its own
// .gitignore's and those of every folder above it.
func (p *ProjectIgnores) patternsFor(segments []string) []gitignore.Pattern {
	key := strings.Join(segments, "/")
	if patterns, ok := p.patterns[key]; ok {
		return patterns
	}

	var inherited []gitignore.Pattern
	if len(segments) > 0 {
		inherited = p.patternsFor(segments[:len(segments)-1])
	}
	osDir := filepath.Join(append([]string{p.root}, segments...)...)
	patterns := append(slices.Clip(inherited), patternsInDir(osDir, segments)...)
	p.patterns[key] = patterns
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
