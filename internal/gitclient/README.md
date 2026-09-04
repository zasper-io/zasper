# gitclient

The git backend: everything the source control panel reads, and everything it changes.

**go-git answers questions, the `git` binary changes things.** That split runs through the whole
package and is the first thing to know about it — see [git_cli.go](git_cli.go), whose header says the
same in shorter form.

## Why hybrid

go-git's reads are good, it is already in `go.mod`, and its `Worktree.Status()` honours `.gitignore`.
Its writes are the problem. Its own `COMPATIBILITY.md` lists **stash, non-fast-forward merge, rebase,
cherry-pick, revert, apply, describe and bisect** as unsupported, and it never runs **hooks** or
consults a **credential helper**.

So a commit made by running `git`:

- resolves `user.name` / `user.email` out of the user's own gitconfig,
- runs their `pre-commit` hook,
- honours `commit.gpgsign`,

and a push gets their credential helper, their `ssh-agent` and their `known_hosts`. The version of
this package before the rewrite called go-git's `Push` with an empty `PushOptions`, which cannot
succeed against any HTTPS remote or any SSH remote whose key needs a passphrase.

The other half of the argument is the error text. `CommandError` carries git's stderr, so a user
sees _"Please tell me who you are"_ or _"Updates were rejected because the remote contains work that
you do not have locally"_ — each of which is something they can act on. The old panel rendered all of
it as `alert('An error occurred while committing changes.')`.

What it costs is a dependency on a git binary. [`Available()`](git_cli.go) reports whether there is
one, and a machine without it gets a panel that lists changes and cannot change them, rather than a
500 per click.

## The files

| File                                                     | What is in it                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [repo.go](repo.go)                                       | Opening the repository a project is inside (`DetectDotGit`), and confining a path from a request to it.     |
| [git_cli.go](git_cli.go)                                 | The whole subprocess surface: `run`, `write`, the index mutex, `Available`, `CommandError`, `Refusal`.      |
| [status.go](status.go)                                   | `StatusResponse` and the stage / unstage / discard / commit writes.                                         |
| [branches.go](branches.go)                               | Listing branches, checkout, create, delete, and what a branch may be called.                                |
| [remote.go](remote.go)                                   | Fetch, pull, push.                                                                                          |
| [history.go](history.go)                                 | The paged log, and one commit's files with insertion/deletion counts.                                        |
| [diff.go](diff.go)                                       | The two sides of one file's comparison, notebooks included.                                                  |
| [gitclient_manager.go](gitclient_manager.go)             | Three small questions asked from everywhere: current branch, unborn HEAD, has a remote.                     |
| [gitclient_api_handler.go](gitclient_api_handler.go)     | The HTTP layer, and the rules about what a failure answers with.                                             |

Every function below the handlers takes a **repository root** rather than reading
`core.Zasper.HomeDir` itself. Git paths are relative to that root, and it is what lets the tests work
on a directory of their own. [repo.go](repo.go) holds the one exception, `projectDir()`, so that it
stays the only one.

## Endpoints

Registered in [router.go](../server/router.go) under `/api/git/`.

| Route                            | Engine                       | Answers                          |
| -------------------------------- | ---------------------------- | -------------------------------- |
| `GET /api/git/status`            | go-git (+ `rev-list`)        | `StatusResponse`                 |
| `GET /api/git/log?limit=&skip=`  | go-git                       | `LogResponse`, one page          |
| `GET /api/git/commit/{hash}`     | go-git                       | `CommitDetail`                   |
| `GET /api/git/diff?path=…`       | go-git + the worktree        | `DiffResponse`                   |
| `GET /api/git/branches`          | go-git                       | `BranchesResponse`               |
| `POST /api/git/stage`            | `git add`                    | `StatusResponse`                 |
| `POST /api/git/unstage`          | `git restore --staged` / `git rm --cached` | `StatusResponse`    |
| `POST /api/git/discard`          | `git restore --worktree` / `git clean -fdq` | `StatusResponse`   |
| `POST /api/git/commit`           | `git commit -m`              | `StatusResponse`                 |
| `POST /api/git/checkout`         | `git checkout`               | `StatusResponse`                 |
| `DELETE /api/git/branches`       | `git branch -d` / `-D`       | `StatusResponse`                 |
| `POST /api/git/fetch`            | `git fetch`                  | `StatusResponse`                 |
| `POST /api/git/pull`             | `git pull`                   | `StatusResponse`                 |
| `POST /api/git/push`             | `git push`                   | `StatusResponse`                 |
| `POST /api/git/init`             | `git init`                   | `StatusResponse`                 |
| `GET /api/current-branch`        | go-git                       | `BranchResponse`                 |

`/api/current-branch` survives from the old surface because the status bar wants one string on boot
and nothing else. `/api/uncommitted-files`, `/api/commit-graph` and `/api/commit-and-maybe-push` are
gone.

**Every write answers with the status the repository is now in.** Not an acknowledgement: the panel
applies what comes back, so an action shows its own effect with no second request to race against,
and there is no window in which the panel shows what was true before the click.

**Reads carry `isRepository`.** A project directory is not obliged to be under git, and that is a
state to draw rather than an error — answering 500 for it said the server was broken when it was not.
The two exceptions are `commit/{hash}` and `diff`, which 404 instead: nothing asks either of those
except a panel that has just been shown the thing it is asking about.

**A failed write is a 409 carrying git's own words.** An unset `user.email`, credentials the helper
could not supply, a push behind its remote, a checkout that would lose work — all user-fixable, and a
red "internal error" for a missing `user.name` sends people to the wrong place. 500 is kept for
genuine faults. `failed()` in [gitclient_api_handler.go](gitclient_api_handler.go) is the one place
that decides, keyed on two error types:

- **`CommandError`** — git exited non-zero. Its `Error()` is git's stderr.
- **`Refusal`** — this package declining, in its own words: discarding an untracked file without
  being told that means deleting it, deleting a remote-tracking ref, pushing with no remote, a branch
  name git would read as an option.

## Status, and what go-git gets wrong about it

`StatusResponse` has **four lists** — staged, unstaged, untracked, conflicted — because staging is
the point of the panel. The old single list of names filtered on `state.Worktree != git.Unmodified`,
so a file that was staged and not touched again vanished from the panel entirely, and a file staged
and then edited again could not appear in both places at once. All four are `[]` and never `null`:
the panel counts every one of them on each render.

Three things `Worktree.Status()` cannot express, each corrected in [status.go](status.go):

| What                       | Why go-git misses it                                                                                                                            | What is done                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Merge conflicts**        | A status is HEAD vs index vs worktree, and a conflicted path comes out of that looking like an ordinary modification. `UpdatedButUnmerged` is never reported. | `conflictedPaths` reads the index: a conflict is a path held at stage 2 (ours) and stage 3 (theirs). |
| **Staged deletions**       | `git rm --cached` leaves a file staged for deletion and untracked on disk; go-git reports only the untracked half. git's own short status prints both `D` and `??`. | `stagedDeletions` looks the untracked paths up in HEAD's tree.            |
| **Renames**                | The index is diffed path by path, so `git mv` arrives as a `D` and an `A` that happen to hold one blob — and the panel showed a file the user still has as deleted. | `stagedRenames` pairs them by hash into a single `R` with a `From`.       |

Two smaller decisions: the walk uses the **`Preload` strategy**, because go-git's default can report
an unmodified file as untracked (its issue #119) — which in a panel means offering to add a file that
is already committed; and each list is **sorted**, because a status is a map and the panel reordered
itself on every refresh without it.

Ahead/behind comes from `git rev-list --left-right --count HEAD...@{upstream}` — the one read that is
not go-git. Counting both sides of a symmetric difference means walking both histories until their
frontiers meet, which `rev-list` already does and doing it here would either get wrong about merges
or pay for the whole history. A branch with no upstream is not a failure: it is zeros and an empty
`Upstream`.

### The writes

- **`stage`** is `git add` and nothing else. A directory is staged whole, which is what selecting a
  folder means.
- **`unstage`** is `git restore --staged`, or `git rm --cached` when HEAD is unborn — `restore` and
  `reset` both fail there with "Failed to resolve 'HEAD'". That is every project between `git init`
  and its first commit, so it is not an edge case.
- **`discard`** splits the paths: tracked ones are `git restore --worktree`, untracked ones are
  `git clean -fdq` — a **delete with no undo**, so a request naming one is refused unless it says it
  means to.
- **`commitStaged`** is `git commit -m`, **staged only**. This is the bug the rewrite existed to fix:
  the old code added the files it was given and then committed with go-git's `All: true`, so ticking
  one file of five committed five.

## Paths from a request

Every path a request carries goes through `relPath` in [repo.go](repo.go), which confines it to the
repository and returns it relative to the root, in the form git wants. `content.GetSafePath` cannot
be reused: it confines to `core.Zasper.HomeDir`, and the repository root is often **above** that.

The check resolves symlinks so a link out of the tree cannot be followed out of it, and compares with
the separator attached, since a plain prefix test lets `../repoX-secrets` out of `.../repoX`. A path
that does not exist yet — a deleted file — has its deepest existing parent resolved instead.
`relPaths` refuses the whole request if any one path is out: a batch that quietly dropped the path it
did not like would stage or discard the wrong set.

Paths then reach git after `--` (`pathArgs`), because a file called `-f`, or one called `HEAD`, is a
file and not an option or a revision.

## Concurrency, environment and timeouts

- **One write at a time.** `indexLock` serialises every command that changes the repository. Two
  requests staging at once both take `.git/index.lock`, and the second fails with an error about the
  first that says nothing to whoever pressed the button. `fetch` deliberately does **not** take it —
  it writes no file anyone is looking at, and holding the lock for a slow remote would make a fetch
  the reason a click on Stage does nothing.
- **`GIT_TERMINAL_PROMPT=0`**, so nothing stops to ask a terminal that is not there for a password,
  and **`GIT_OPTIONAL_LOCKS=0`**, so a status refresh is never what blocks a commit. The rest of the
  environment is inherited: that is where a credential helper's configuration and `SSH_AUTH_SOCK`
  live.
- **`networkTimeout` (2 minutes)** on fetch, pull and push. Without it a push to an unreachable host
  holds the request open until the browser gives up, and holds the index lock while it does.

## Diffs

`DiffResponse` is **two whole documents, not a patch**, because the viewer is a CodeMirror
`MergeView` that computes the difference itself. An absent side is an empty document, which is what
makes an added file read as all additions and a deleted one as all deletions with no flag for either.

Which two sides depends on what was asked for, and the three cases are the three questions the panel
asks:

| Asked for       | Original            | Modified        | What it means                     |
| --------------- | ------------------- | --------------- | --------------------------------- |
| `ref=<hash>`    | that commit's first parent | that commit | what the commit did          |
| `staged=true`   | HEAD                | the index       | what a commit would record        |
| neither         | the index           | the file on disk | what a commit would leave behind |

`from` names a rename's old path and is read on the original side; without it a rename is a whole
file added and nothing deleted. For a conflicted file the index side is read at **stage 2 (ours)**,
which is the version the worktree's markers were written around — go-git's own `Entry` would answer
with the merge base.

Three ways a comparison comes back empty on purpose, each with its own flag so the tab can say why:
`tooLarge` past 2 MiB a side (both sides are held in memory, JSON-encoded, and handed to a diff
algorithm in a browser tab), `isBinary` by git's own heuristic (a NUL byte in the first 8000 bytes),
and nothing at all — a path on neither side is a `missingPath`, answered as 404, because an empty
diff of nothing looks exactly like a file that has not changed.

**A notebook is compared as its cell sources**, via [internal/nbformat](../nbformat), with outputs,
execution counts and metadata left out and each cell introduced by a `# %% [3] code` marker in the
form Jupytext and VS Code use. A raw `.ipynb` comparison is base64 image data and `execution_count`
renumbered by every run, so running a notebook and changing nothing shows as a changed file. Both
sides are rendered or neither: one side as cells and the other as raw JSON is every line changed,
which is worse than the JSON on both. A file with the extension that nbformat cannot read — a merge
conflict left in the JSON — is compared as the text it is.

## History

`getLog` is **paged**: 50 commits by default, 500 at most. The endpoint it replaced walked to the
root commit on every read — on boot, and again after every commit, pull and branch switch. Paging is
`skip` many `Next` calls, because go-git offers no way to start a log at an offset, and `hasMore` is
one `Next` past the page rather than a count of the history, which nobody asked for.

`getCommitDetail` is a read of its own, so opening one row of thirty does not cost thirty diffs. It
compares against the **first parent**, which is what `git show` does: a merge against all its parents
shows only the conflicts resolved by hand, and a clean merge shows nothing at all. The file list is
cut at 500 with `truncated: true`, since each entry costs a content diff of both blobs.

`Commit` splits `subject` from `body` the way git does, and `date` is **RFC 3339** — the old endpoint
sent Go's `time.Time.String()`, which no browser can parse, which is why the old history showed no
date at all.

## Branches

Local branches first, then remote-tracking refs, each group sorted; `origin/HEAD` is left out because
it is a symbolic ref naming another branch already in the list. The upstream is read from the
**configuration** rather than resolved as a ref: a branch can track something that has not been
fetched yet, and it still tracks it.

Checking out a name that only exists on the remote uses `--track`, so it becomes a local branch
following it — plain `git checkout origin/topic` leaves a detached HEAD, which is not what clicking a
branch in a list means. Deleting is local only: `git branch -dr` would remove the tracking ref and
leave the branch on the server, so a remote name is refused rather than half-honoured.

`validBranchName` refuses an empty name, a name `check-ref-format` rejects, and — the reason it
exists — **a name beginning with `-`**: the name arrives from a browser and ends up in an argv, where
`git checkout -b -f` is a checkout with an option where a branch was meant. `check-ref-format` allows
a leading dash, so this is the package's job.

A checkout that would overwrite uncommitted work is left to git, which refuses it and names the files
in the way. Pre-empting that with a dialog here would either duplicate the check or offer to throw
away changes it cannot list.

## Tests

```sh
go test ./internal/gitclient/                      # unit
go test -tags apiserver ./internal/server/ -run Git # over HTTP
```

[status_test.go](status_test.go) and [diff_test.go](diff_test.go) build real repositories in
`t.TempDir()` and cover what the corrections above are for: a conflicted file, a file removed from
the index but not from disk, `git mv` as one rename, empty lists rather than nulls, `../` and
absolute paths refused, the three comparisons, an added and a deleted file, a rename read from its
old name, a notebook as cell sources, a binary file and one too large, and a conflicted file compared
against ours.

[internal/server/git_e2e_test.go](../server/git_e2e_test.go) drives the endpoints over HTTP against a
repository per test — including **push to a `git init --bare` temp directory added as `origin`**,
which tests the push path with no network and no credentials, and a failed push after a successful
commit, which has to say both things happened.

Above those, [e2e/tests/git.spec.ts](../../e2e/tests/git.spec.ts) drives the panel in a browser
against a throwaway repository and reads the result back with `git` itself.

## Not implemented

- **Merge-conflict resolution.** Conflicted files are listed, their `U` state shown and their diff
  readable; resolving means a three-way editor.
- **Stash, rebase, cherry-pick, revert, blame, tags, submodules, clone.**
- **`--amend` from the UI.** The endpoint takes `amend`; nothing in the panel sends it.
- **No `--prune` on fetch.** Fetching is the safe half of syncing, and pruning deletes refs.
- **Push and pull are the current branch to its own upstream.** No remote or refspec from the
  browser, which would be a worse `git push`.
- **Exact renames only.** A file moved and edited in one step stays two rows, which is what git falls
  back to when its own similarity score is not met.
