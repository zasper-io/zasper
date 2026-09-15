package search

import (
	"bufio"
	"context"
	"encoding/json"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/content"
)

/*
find sends every file with a match to found, and closes it when the search is over or ctx is done.

With ripgrep installed it finds the lines, and the run matches them again itself: the ranges, the options'
meaning and the replacements then come from one regular expression engine whichever found the line, so a
search answers the same on a machine without it. Notebooks are never given to ripgrep, which would read
them as JSON.
*/
func (r *run) find(ctx context.Context, ripgrep string, found chan<- FileMatches) {
	defer close(found)
	notebooksOnly := false
	if ripgrep != "" {
		if err := r.ripgrep(ctx, ripgrep, found); err == nil {
			notebooksOnly = true
		} else if ctx.Err() == nil {
			log.Debug().Err(err).Msg("ripgrep failed; searching without it")
		}
	}
	if ctx.Err() == nil {
		r.walk(ctx, found, notebooksOnly)
	}
}

// walk searches the project itself, in parallel, leaving out what the file browser and the palette leave out.
func (r *run) walk(ctx context.Context, found chan<- FileMatches, notebooksOnly bool) {
	ignores := content.NewProjectIgnores(r.root)
	paths := make(chan string)

	var workers sync.WaitGroup
	for range runtime.GOMAXPROCS(0) {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for relative := range paths {
				if ctx.Err() != nil {
					continue
				}
				if match := r.searchPath(relative); match != nil {
					select {
					case found <- *match:
					case <-ctx.Done():
					}
				}
			}
		}()
	}

	filepath.WalkDir(r.root, func(osPath string, entry fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return fs.SkipAll
		}
		if err != nil || osPath == r.root {
			return nil
		}
		relative, relErr := filepath.Rel(r.root, osPath)
		if relErr != nil {
			return nil
		}
		relative = filepath.ToSlash(relative)
		if ignores.Skips(osPath, entry.IsDir()) || (entry.IsDir() && r.scope.excludes(relative)) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() || !r.scope.admits(relative) {
			return nil
		}
		if notebooksOnly && !isNotebook(relative) {
			return nil
		}
		select {
		case paths <- relative:
		case <-ctx.Done():
			return fs.SkipAll
		}
		return nil
	})

	close(paths)
	workers.Wait()
}

func (r *run) searchPath(relative string) *FileMatches {
	osPath := filepath.Join(r.root, filepath.FromSlash(relative))
	info, err := os.Stat(osPath)
	if err != nil || info.Size() > maxFileSize {
		return nil
	}
	data, err := os.ReadFile(osPath)
	if err != nil {
		return nil
	}
	return r.fileMatches(relative, data)
}

// What ripgrep writes with --json, as far as a search reads it.
type rgMessage struct {
	Type string `json:"type"`
	Data struct {
		Path       rgText `json:"path"`
		Lines      rgText `json:"lines"`
		LineNumber int    `json:"line_number"`
	} `json:"data"`
}

// ripgrep's text or, for bytes that are not UTF-8, base64 of them, which a search skips.
type rgText struct {
	Text  *string `json:"text"`
	Bytes *string `json:"bytes"`
}

/*
ripgrep finds the matching lines of every file but notebooks. Its own ignore files are turned off where the
walk has nothing like them — .ignore, the global excludes, .git/info/exclude and the folders above the
project — so the two leave out the same files.

The pattern it is given can only find more lines than the query matches, never fewer: the options it could
disagree on, whole word among them, are applied by the run afterwards.
*/
func (r *run) ripgrep(ctx context.Context, binary string, found chan<- FileMatches) error {
	args := []string{
		"--json", "--no-config", "--hidden", "--no-require-git",
		"--no-ignore-dot", "--no-ignore-global", "--no-ignore-exclude", "--no-ignore-parent",
		"--max-filesize", "10M", "--glob", "!*.ipynb", "--glob", "!*.IPYNB",
	}
	for _, folder := range content.SkippedFolders() {
		args = append(args, "--glob", "!"+folder+"/")
	}
	if r.query.CaseSensitive {
		args = append(args, "--case-sensitive")
	} else {
		args = append(args, "--ignore-case")
	}
	if !r.query.Regexp {
		args = append(args, "--fixed-strings")
	}
	args = append(args, "--regexp", r.query.Pattern, "--", ".")

	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = r.root
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	var current *FileMatches
	lines := bufio.NewScanner(stdout)
	lines.Buffer(make([]byte, 64<<10), maxFileSize+(1<<20))
	for lines.Scan() {
		var message rgMessage
		if json.Unmarshal(lines.Bytes(), &message) != nil || message.Data.Path.Text == nil {
			continue
		}
		relative := strings.TrimPrefix(filepath.ToSlash(*message.Data.Path.Text), "./")
		switch message.Type {
		case "begin":
			current = &FileMatches{Path: relative, Kind: "file", Lines: []LineMatch{}}
			if !r.scope.admits(relative) {
				current = nil
			}
		case "match":
			if current == nil {
				continue
			}
			// A line that is not UTF-8 is in a file the editor would not open as text.
			if message.Data.Lines.Text == nil {
				current = nil
				continue
			}
			line := strings.TrimSuffix(strings.TrimSuffix(*message.Data.Lines.Text, "\n"), "\r")
			if match, ok := r.lineMatch(message.Data.LineNumber, line); ok {
				current.Lines = append(current.Lines, match)
			}
		case "end":
			if current != nil && len(current.Lines) > 0 {
				select {
				case found <- *current:
				case <-ctx.Done():
				}
			}
			current = nil
		}
	}

	err = cmd.Wait()
	// 1 is ripgrep finding nothing, which is an answer.
	if exit, ok := err.(*exec.ExitError); ok && exit.ExitCode() == 1 {
		return nil
	}
	return err
}
