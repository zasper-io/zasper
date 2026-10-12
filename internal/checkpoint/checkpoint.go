/*
Package checkpoint keeps snapshots of a project's files, so what changed between two moments can be
listed, shown and put back — an agent's turn, whatever wrote the files in it: the agent's own edits, a
command it ran, a notebook tool.

The snapshots are trees in a git repository of Zasper's own under ~/.zasper/checkpoints, with the
project as its work tree. The project's own repository, if it has one, is never touched. git runs with
no global or system configuration and no hooks, so a filter such as git-lfs or line-ending conversion
never applies: a snapshot holds the bytes on disk. What .gitignore leaves out, the folders every walk
skips, and files over maxFileBytes are not kept.

A snapshot still wanted is pinned by a ref, under the running server's pid; Release drops a chat's and
prunes what nothing pins any more. When a server starts, the pins of servers no longer running are
dropped, and the stores of projects not snapshotted for staleAfter are removed whole.
*/
package checkpoint

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/zasper-io/zasper/internal/atomicfile"
	"github.com/zasper-io/zasper/internal/content"
	"github.com/zasper-io/zasper/internal/runtimeinfo"
)

const (
	// The largest file a snapshot keeps. A dataset written by a run is not something to copy on every turn.
	maxFileBytes = 20 << 20
	// How long a project's store is kept after its last snapshot.
	staleAfter = 30 * 24 * time.Hour
)

// ErrNoGit says there is no git binary to keep snapshots with.
var ErrNoGit = errors.New("git is not installed")

// Store is one project's snapshots.
type Store struct {
	root string
	dir  string
	git  string

	mu     sync.Mutex
	inited bool
}

var (
	storesMu sync.Mutex
	stores   = map[string]*Store{}
	swept    sync.Once
)

// For is the store of the project at root, shared by everything in the server that snapshots it.
func For(root string) (*Store, error) {
	git, err := exec.LookPath("git")
	if err != nil {
		return nil, ErrNoGit
	}
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	storesMu.Lock()
	defer storesMu.Unlock()
	if store, ok := stores[root]; ok {
		return store, nil
	}
	sum := sha256.Sum256([]byte(root))
	store := &Store{root: root, dir: filepath.Join(home, ".zasper", "checkpoints", hex.EncodeToString(sum[:8])), git: git}
	stores[root] = store
	swept.Do(func() { go sweep(filepath.Dir(store.dir), store.dir) })
	return store, nil
}

// sweep removes the stores of projects not snapshotted for staleAfter, except keep.
func sweep(dir, keep string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		if !entry.IsDir() || path == keep {
			continue
		}
		last, err := os.Stat(filepath.Join(path, "index"))
		if err != nil {
			last, err = os.Stat(path)
		}
		if err == nil && time.Since(last.ModTime()) > staleAfter {
			os.RemoveAll(path)
		}
	}
}

// Dir is the store's own git directory.
func (s *Store) Dir() string { return s.dir }

// pins is where this server's pins are.
func pins() string {
	return fmt.Sprintf("refs/zasper/%d/", os.Getpid())
}

func (s *Store) run(ctx context.Context, stdin []byte, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, s.git, append([]string{
		"--git-dir=" + s.dir, "--work-tree=" + s.root,
		"-c", "core.hooksPath=" + os.DevNull, "-c", "core.fsmonitor=false",
	}, args...)...)
	cmd.Dir = s.root
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL="+os.DevNull, "GIT_CONFIG_NOSYSTEM=1",
		"GIT_TERMINAL_PROMPT=0", "GIT_INDEX_FILE="+filepath.Join(s.dir, "index"))
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("git %s: %v: %s", args[0], err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}

func (s *Store) init(ctx context.Context) error {
	if s.inited {
		return nil
	}
	if _, err := os.Stat(filepath.Join(s.dir, "HEAD")); err != nil {
		if err := os.MkdirAll(s.dir, 0o700); err != nil {
			return err
		}
		if _, err := s.run(ctx, nil, "init", "--quiet"); err != nil {
			return err
		}
		if _, err := s.run(ctx, nil, "config", "gc.auto", "0"); err != nil {
			return err
		}
	}
	excluded := []string{".zasper/"}
	for _, name := range content.SkippedFolders() {
		excluded = append(excluded, name+"/")
	}
	if err := os.MkdirAll(filepath.Join(s.dir, "info"), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(s.dir, "info", "exclude"), []byte(strings.Join(excluded, "\n")+"\n"), 0o600); err != nil {
		return err
	}
	s.inited = true
	return s.dropDeadPins(ctx)
}

// dropDeadPins drops the pins of servers that are no longer running: a crash leaves them behind.
func (s *Store) dropDeadPins(ctx context.Context) error {
	live := map[string]bool{strconv.Itoa(os.Getpid()): true}
	if servers, err := runtimeinfo.List(); err == nil {
		for _, server := range servers {
			live[strconv.Itoa(server.PID)] = true
		}
	}
	refs, err := s.run(ctx, nil, "for-each-ref", "--format=%(refname)", "refs/zasper/")
	if err != nil {
		return err
	}
	var dead []string
	for _, ref := range strings.Fields(string(refs)) {
		if pid, _, _ := strings.Cut(strings.TrimPrefix(ref, "refs/zasper/"), "/"); !live[pid] {
			dead = append(dead, ref)
		}
	}
	return s.drop(ctx, dead)
}

// drop deletes refs, and the objects only they kept.
func (s *Store) drop(ctx context.Context, refs []string) error {
	if len(refs) == 0 {
		return nil
	}
	var commands bytes.Buffer
	for _, ref := range refs {
		fmt.Fprintf(&commands, "delete %s\n", ref)
	}
	if _, err := s.run(ctx, commands.Bytes(), "update-ref", "--stdin"); err != nil {
		return err
	}
	_, err := s.run(ctx, nil, "prune", "--expire=now")
	return err
}

// Release unpins the snapshots pinned under prefix, and removes what nothing else keeps.
func (s *Store) Release(ctx context.Context, prefix string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.inited {
		return nil
	}
	refs, err := s.run(ctx, nil, "for-each-ref", "--format=%(refname)", pins()+prefix+"/")
	if err != nil {
		return err
	}
	return s.drop(ctx, strings.Fields(string(refs)))
}

/*
Snapshot records the project's files as they are now, and answers the tree that holds them. A pin, such
as "<chat>/<turn>/before", keeps it until Release is given the start of the pin; with none it may go at
the next prune.
*/
func (s *Store) Snapshot(ctx context.Context, pin string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.init(ctx); err != nil {
		return "", err
	}
	// Only what changed since the last snapshot is read again: the index remembers the rest by its stat.
	gone, err := s.run(ctx, nil, "ls-files", "-z", "--deleted")
	if err != nil {
		return "", err
	}
	if len(gone) > 0 {
		if _, err := s.run(ctx, gone, "update-index", "-z", "--force-remove", "--stdin"); err != nil {
			return "", err
		}
	}
	changed, err := s.run(ctx, nil, "ls-files", "-z", "--others", "--modified", "--exclude-standard")
	if err != nil {
		return "", err
	}
	var kept bytes.Buffer
	for _, path := range strings.Split(string(changed), "\x00") {
		// A folder listed whole is another repository inside this one, which is not ours to read.
		if path == "" || strings.HasSuffix(path, "/") {
			continue
		}
		info, err := os.Lstat(filepath.Join(s.root, filepath.FromSlash(path)))
		if err != nil || !info.Mode().IsRegular() || info.Size() > maxFileBytes {
			continue
		}
		kept.WriteString(path)
		kept.WriteByte(0)
	}
	if kept.Len() > 0 {
		if _, err := s.run(ctx, kept.Bytes(), "update-index", "-z", "--add", "--remove", "--stdin"); err != nil {
			return "", err
		}
	}
	out, err := s.run(ctx, nil, "write-tree")
	if err != nil {
		return "", err
	}
	tree := strings.TrimSpace(string(out))
	if pin != "" {
		if _, err := s.run(ctx, nil, "update-ref", pins()+pin, tree); err != nil {
			return "", err
		}
	}
	return tree, nil
}

// Change is one file that differs between two snapshots.
type Change struct {
	Path string `json:"path"`
	// A: added, M: modified, D: deleted.
	Status string `json:"status"`
	// The blobs on either side, empty where the file is absent.
	Before string `json:"-"`
	After  string `json:"-"`
	// Whether the file was executable before.
	executable bool
}

const emptyBlob = "0000000000000000000000000000000000000000"

// Changes lists the files that differ between two snapshots, by path.
func (s *Store) Changes(ctx context.Context, before, after string) ([]Change, error) {
	if before == after {
		return nil, nil
	}
	out, err := s.run(ctx, nil, "diff-tree", "-r", "-z", "--no-renames", before, after)
	if err != nil {
		return nil, err
	}
	// :<mode> <mode> <blob> <blob> <status>\0<path>\0, repeated.
	fields := strings.Split(strings.TrimSuffix(string(out), "\x00"), "\x00")
	var changes []Change
	for i := 0; i+1 < len(fields); i += 2 {
		meta := strings.Fields(strings.TrimPrefix(fields[i], ":"))
		if len(meta) != 5 {
			continue
		}
		change := Change{Path: fields[i+1], Status: meta[4][:1], Before: meta[2], After: meta[3], executable: meta[0] == "100755"}
		if change.Before == emptyBlob {
			change.Before = ""
		}
		if change.After == emptyBlob {
			change.After = ""
		}
		changes = append(changes, change)
	}
	return changes, nil
}

// Blob reads a file's contents as a snapshot holds them.
func (s *Store) Blob(ctx context.Context, blob string) ([]byte, error) {
	return s.run(ctx, nil, "cat-file", "blob", blob)
}

// Hash is the blob a file now on disk would be, or "" when there is no file.
func (s *Store) Hash(ctx context.Context, path string) (string, error) {
	full := filepath.Join(s.root, filepath.FromSlash(path))
	if _, err := os.Lstat(full); errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	out, err := s.run(ctx, nil, "hash-object", "--no-filters", "--", full)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

/*
Restore puts each file back as it was before its change: written again, or removed when the change
added it. A file that has changed since the change was recorded is put back too; callers ask Since first.
*/
func (s *Store) Restore(ctx context.Context, changes []Change) error {
	for _, change := range changes {
		full := filepath.Join(s.root, filepath.FromSlash(change.Path))
		if change.Before == "" {
			if err := os.Remove(full); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			continue
		}
		data, err := s.Blob(ctx, change.Before)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return err
		}
		perm := os.FileMode(0o644)
		if change.executable {
			perm = 0o755
		}
		if info, err := os.Stat(full); err == nil {
			perm = info.Mode().Perm()
		}
		if _, err := atomicfile.Write(full, bytes.NewReader(data), perm); err != nil {
			return err
		}
	}
	return nil
}

// Since names the changes whose file no longer holds what the change left in it.
func (s *Store) Since(ctx context.Context, changes []Change) ([]string, error) {
	var moved []string
	for _, change := range changes {
		now, err := s.Hash(ctx, change.Path)
		if err != nil {
			return nil, err
		}
		if now != change.After {
			moved = append(moved, change.Path)
		}
	}
	return moved, nil
}
