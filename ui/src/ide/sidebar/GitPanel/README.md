# GitPanel

Source control in the sidebar: what has changed, one way to change it, and the history under the box
that writes to it.

The backend it talks to is [internal/gitclient](../../../../../internal/gitclient), whose README covers
the endpoints and why go-git reads while the `git` binary writes. This one is about the panel.

## What it replaced

The panel before it had a list of checkboxes and a commit button, and two bugs that the shape of the
code made invisible:

- **Ticking one file of five committed five.** The server added the ticked files and then committed
  with go-git's `All: true`. There are **no checkboxes here** — what a commit takes is what is staged,
  and the panel shows the index it is about to record so it cannot misrepresent it again.
- **A staged file was not shown at all.** The old status filtered on the worktree side of the index,
  and a file staged and not edited again is unmodified there. Staged, Changes and Untracked are now
  separate sections, and a file edited after being staged is in two of them at once, which is what git
  thinks.

It also said `alert('An error occurred while committing changes.')` for everything. Failures are now
toasts carrying the server's own text, which is git's.

## The layout

```
┌ Source control ────────────────────── ⟳ ┐   content-head: refresh
│  main                    ↓2  ↑1  fetch  │   BranchMenu opens here · SyncActions
├─────────────────────────────────────────┤
│  ┌───────────────────────────────────┐  │
│  │ Commit message                    │  │   CommitBox
│  └───────────────────────────────────┘  │
│    [ Commit ]  [ Commit & Push ]        │   & Push only with a remote
├─────────────────────────────────────────┤
│  Merge conflicts                        │   ChangeList, one per section,
│    U  index.py         src/          +  │   blocks a commit
│  Staged                            −    │
│    M  notes.txt                      −  │   ChangeList
│  Changes                        ↺  +    │
│    M  table.csv        data/            │
│  Untracked                      ↺  +    │
│    ?  scratch.ipynb                     │
├─────────────────────────────────────────┤
│  History                                │
│    a1b2c3d  staged from the panel       │   History → CommitFiles on click
│             Prasun · just now           │
└─────────────────────────────────────────┘
```

Sections with nothing in them render nothing, so a clean repository is a branch bar, a commit box and
the history. Everything below the head is in one scroll area rather than one per section: four
independently scrolling lists in a 300px sidebar is four places to lose a file.

## The files

| File                                                           | What is in it                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [GitPanel.tsx](GitPanel.tsx)                                   | The panel: the sections, the not-a-repository state, and what each row's click opens. |
| [useGitStatus.ts](useGitStatus.ts)                             | The state. One read, one `run` for every write, and the auto-refresh.                 |
| [ChangeList.tsx](ChangeList.tsx)                               | One section of rows: status letter, name, dimmed directory, hover actions.            |
| [CommitBox.tsx](CommitBox.tsx)                                 | The message box and its two buttons. A renderer only.                                 |
| [useCommitAction.ts](useCommitAction.ts)                       | Whether a commit can be made, why not, and making it. Shared with the palette.        |
| [gitCommands.ts](gitCommands.ts)                               | The palette's git entries.                                                            |
| [BranchMenu.tsx](BranchMenu.tsx)                               | List, switch, create, delete a branch.                                                |
| [SyncActions.tsx](SyncActions.tsx)                             | Fetch, pull and push, with the ahead/behind counts as the labels.                     |
| [History.tsx](History.tsx)                                     | The paged log, and which row is open.                                                 |
| [CommitFiles.tsx](CommitFiles.tsx)                             | One commit's files, read when its row is opened.                                      |
| [dates.ts](dates.ts)                                           | "just now", "3 days ago", and the full date for the tooltip.                          |
| [ConfirmDiscardDialog.tsx](ConfirmDiscardDialog.tsx)           | The dialog in front of losing uncommitted work.                                       |
| [ConfirmDeleteBranchDialog.tsx](ConfirmDeleteBranchDialog.tsx) | The same in front of deleting a branch, with the force case.                          |

Outside this directory: [api/git.ts](../../../api/git.ts) is the typed client for every endpoint,
[editor/DiffTab.tsx](../../editor/DiffTab.tsx) draws a comparison, `diffTabKey` and `openDiff` in
[store/TabActions.ts](../../../store/TabActions.ts) open one, and the branch in
[statusBar/StatusBar.tsx](../../statusBar/StatusBar.tsx) is a button that reveals this panel.

## useGitStatus

One hook owns everything: `{ status, loading, busy, error, refresh, run }`.

**It reads nothing while the panel is hidden.** Every sidebar panel stays mounted, so without the
guard a panel nobody has opened polls a repository nobody is looking at — and the same is true of
`History`, which takes `hidden` for its own read. Opening the panel reads again, since what is on
screen is from last time. A test locks this: _'asks the server for nothing while it is hidden'_.

**It refreshes on the content watcher.** [useContentWatcher](../FileBrowser/useContentWatcher.ts) is
already a reconnecting, debounced socket on `/api/contents/watch`, so a save, a commit made in a
terminal, or a branch checked out behind the panel's back all reach it. A source control panel that
does not notice is worse than none.

**`run(action, success?)` is how every write happens.** It sets `busy`, applies the `GitStatus` the
action answers with, toasts `success` or `apiErrorMessage(failure)`, and returns whether it worked —
which matters because the commit message must survive a commit git refused. Because every write
endpoint answers with the resulting status, there is no second read racing behind the click.

**Reads report into the panel; writes report as toasts.** A read happens on its own, whenever the
project changes, so a server that has gone away would raise a toast per watcher event; that failure
belongs in the panel body. A write only ever happens because someone pressed something, and its
failure is the answer to that press.

`apply` also writes `branchNameAtom`, because the status bar reads the branch once on boot and has no
other way of hearing about a checkout. `GitPanel` wraps `run` once more as `changesHistory`, which
bumps the `History` reload key: staging cannot change the log, but committing, pulling and switching
branch all can.

## Diffs

A row's click opens a **tab**, not a panel section — a diff is something to read side by side, which a
sidebar has no room for. `openDiff` keys it with `diffTabKey(target)` → `diff:<ref|staged|worktree>:<path>`
rather than the path, for two reasons: a diff keyed by the file's own path _is_ that file's editor tab
and would replace it, and the staged and unstaged comparisons of one file are two different pairs of
documents, so they have to be two tabs. The names say which: `notes.txt (diff)`, `notes.txt (staged)`,
`notes.txt (a1b2c3d)`.

Each section opens the comparison it is about — Staged asks for HEAD against the index (what a commit
would record), Changes and Untracked for the index against the file on disk (what it would leave
behind), and a history row for the commit against its first parent. A rename passes its `from` so the
old path is read on the original side; without it a rename is a whole file added and nothing deleted.

[DiffTab.tsx](../../editor/DiffTab.tsx) mounts a `MergeView` from `@codemirror/merge`, read-only on
both sides, with unchanged regions collapsed. It renders the server's flags rather than guessing:
binary, too large, notebook-as-cells, renamed, and identical sides.

## The palette

[gitCommands.ts](gitCommands.ts) registers Stage All Changes, Commit, Fetch, Pull, Push and Checkout
Branch… under a `Git` category, from `GitPanel` and **while it is hidden** — the palette is a way in of
its own, and someone who works from it may never open the sidebar.

That is also the constraint on how they are written. A hidden panel has no fresh status, so:

- they are enabled on `!busy` alone, never on a count from a status that may be stale;
- **Stage All** does its own `getGitStatus()` read, and stages the unstaged and untracked paths while
  leaving **conflicted ones out** — staging a conflicted file is how git is told it has been resolved,
  and doing that to a file still full of `<<<<<<<` markers commits them;
- **Commit** commits when there is something to commit, and otherwise `reveal()`s the panel and focuses
  the message box, which answers "why not" better than a toast guessing between an empty message and
  an empty index.

`reveal` comes from [IDE.tsx](../../IDE.tsx), which owns which sidebar panel is on screen.

[useCommitAction.ts](useCommitAction.ts) exists so the panel's button and the palette's command are
one action rather than two. `ready` is a non-empty message, something staged, nothing conflicted and
not busy; `reason` is what to say when it is not, and is the `title` on both buttons; the message is
cleared only on success. Cmd/Ctrl-Enter in the box commits.

## Tests

```sh
npx vitest run src/ide/sidebar/GitPanel      # from ui/
npx playwright test git.spec.ts              # from e2e/, after `npm run build` in ui/
```

[GitPanel.test.tsx](GitPanel.test.tsx) mocks `@/api` and covers the sections and their letters, a file
in Staged and Changes at once, the discard dialog, the not-a-repository and no-git states, the branch
menu, sync actions, history paging, the hidden gate — and the palette commands, rendered together with
a stand-in palette under **one jotai `Provider`**, since the command registry is an atom and therefore
per-store. [useGitStatus.test.tsx](useGitStatus.test.tsx) covers the read, the watcher and `run`.

[e2e/tests/git.spec.ts](../../../../../e2e/tests/git.spec.ts) is the part no mock can reach: it drives
the panel in a browser against a throwaway repository and reads the result back with `git` itself,
which is the only way to catch a commit that took more than what was staged. It also covers the
MergeView, which cannot mount under jsdom at all.

## Not implemented

- **Conflict resolution.** Conflicted files are listed, marked `U` and readable as a diff; resolving
  them means a three-way editor.
- **Staging a hunk or a line.** Everything here is whole files.
- **`--amend`, stash, rebase, cherry-pick, revert, blame, tags, clone.**
- **A commit graph with lanes.** History is a list; the `x`/`y` layout the old `CommitGraph` computed
  and never drew is gone.
- **Git decorations in the file tree.** The panel is the only place a change is shown.
