# tabs

The tab strip, and the state behind it: what a tab is, who is allowed to change the set of them, when
a tab reads the file it names, and how the strip comes back after the browser tab is closed.

The strip itself is small — a list of buttons. Almost everything worth knowing is in the two rules it
keeps: **exactly one tab is in front**, and **a tab reads itself once**. Both are easy to break from
the outside, which is why the state lives in `store/` behind one hook rather than in this directory.

## What a tab is

```ts
interface IfileTab {
  type: string; // 'launcher' | 'file' | 'notebook' | 'diff' | 'terminal'
  path: string; // also the key it is stored under
  name: string; // what the strip shows
  active: boolean; // exactly one tab's is true
  extension: string | null;
  load_required: boolean; // "read yourself now" — a pulse, not a property
  kernelspec: string; // notebooks; 'none' when unknown
  cwd?: string; // terminals only
  diff?: DiffTarget; // diffs only
  unloaded?: boolean; // restored, never read; absent means loaded
}
```

The open tabs are a **dictionary keyed by path** (`IfileTabDict`), not an array, and the strip's order
is that object's insertion order. Two consequences worth holding on to: a tab is found by path
everywhere, and anything rebuilding the dictionary has to rebuild it _in order_ — which is why
`renameTab` constructs a new object rather than reassigning a key.

`type` decides which editor is rendered, in [../editor/Editor.tsx](../editor/Editor.tsx): a `file`
whose extension is `png` gets the image editor, everything else the code editor.

Three kinds carry something extra:

- **The Launcher** is always open, always first, and is the fallback when the tab in front is closed.
  It is the only tab with no close button, and `removeTabs` re-activates it when nothing is left
  active. Anything that rebuilds the strip has to keep it.
- **A diff** is keyed by `diffTabKey(target)` — `diff:staged:notes.txt` — and not by the file's path,
  because the path is the key: a diff sharing it would _be_ the editor for that file. The file's own
  path is inside `diff`, which also means a diff tab is not rewritten on rename or closed on delete,
  since both of those walk the tabs by path. A stale diff is a comparison that was true when it was
  opened, which is what any diff already is.
- **A terminal** is keyed by its display name (`Terminal 1`), minted from `terminalsCountAtom`.

## The pieces

| File                                                             | What it does                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [TabIndex.tsx](TabIndex.tsx)                                     | The strip: a button per tab, its mark, its unsaved dot, its ×. Activation is one call. |
| [UnsavedChangesDialog.tsx](UnsavedChangesDialog.tsx)             | Save / Don't Save / Cancel, for closing a tab with unsaved work.                       |
| [../../store/TabState.tsx](../../store/TabState.tsx)             | `fileTabsAtom`, the default strip, `withActive`, and the seed from the last visit.     |
| [../../store/TabActions.ts](../../store/TabActions.ts)           | `useTabActions()` — the only way to change the set of tabs.                            |
| [../../store/TabStorage.ts](../../store/TabStorage.ts)           | The remembered strip: what is written to localStorage, and what a record restores to.  |
| [../../store/useRememberTabs.ts](../../store/useRememberTabs.ts) | Keeps the record in step, and drops one belonging to another project.                  |

Two things outside this path matter as much: [../editor/ContentPanel.tsx](../editor/ContentPanel.tsx)
renders **every** tab and hides the inactive ones, so all editors stay mounted; and
[../../store/UnsavedState.ts](../../store/UnsavedState.ts) holds `unsavedTabsAtom`, a map of path to a
save function, which each editor registers while it has unsaved work.

## One choke point

Every change to the set of tabs goes through `useTabActions()`:

| Action                | What it is for                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openTab(tab)`        | Open a path, or bring it to the front if it is already open.                                                                                                                    |
| `activateTab(path)`   | Bring an open tab to the front. A no-op for a path that is not open.                                                                                                            |
| `openDiff(target)`    | Open one comparison of one file.                                                                                                                                                |
| `openTerminal(cwd?)`  | Open a numbered terminal.                                                                                                                                                       |
| `closeTab(path)`      | Close a tab. **The kernel keeps running**, as in JupyterLab.                                                                                                                    |
| `closeDeleted(path)`  | After a delete on disk: close the tab, and everything inside it if it was a folder. **This one does kill the kernels**, since there is no reopening the notebook to reach them. |
| `renameTab(old, new)` | After a rename: move the affected tabs, so a save goes to the file that now exists.                                                                                             |

It is shared because the file browser, the command palette, the Git panel, the Jupyter panel and the
Launcher all open tabs, and a tab left pointing at a path that no longer exists recreates the old file
on its next save. `openTab` also reports the open to telemetry, for genuinely new tabs only.

Activation used to live in this directory, as a handler that rebuilt the dictionary by hand and
invented a tab for a path it did not find. It is now `activateTab`, and both it and `openTab` end in
`withActive(tabs, path)` — the single place that decides what is in front and what loads.

## When a tab reads its file

`load_required` is a **pulse**, not a property: true for the one tab about to read itself, false
everywhere else, cleared on the way past by `withActive`. The editors act on it —
[../editor/FileEditor.tsx](../editor/FileEditor.tsx),
[../editor/ImageEditor.tsx](../editor/ImageEditor.tsx) and
[../editor/notebook/NotebookEditor.tsx](../editor/notebook/NotebookEditor.tsx), whose effect also
starts or rejoins the kernel — and nothing else asks a file to be read.

`unloaded` is the other half, and it exists for restored tabs: on screen, never read in this window,
and reading itself the first time it is brought to the front. `withActive` turns one into the other:

```ts
next[path] = { ...target, active: true, load_required: target.unloaded === true, unloaded: false };
```

**Absent means loaded, and that polarity is load-bearing.** A flag meaning "has loaded" would be
absent on every tab built anywhere but `openTab` — a test fixture, some future caller — and
activation would then set `load_required` on it. That re-reads the file from disk, which would throw
away whatever the reader had typed into a tab they merely switched away from and back to. So:
switching tabs is never a refresh.

Because `ContentPanel` mounts every tab either way, a restored strip of ten notebooks is ten mounted
editors — but only the one in front fetches, and only it starts a kernel.

[../editor/DiffTab.tsx](../editor/DiffTab.tsx) is the exception that had to be taught this: it fetches
in an effect of its own rather than on `load_required`, so it is gated on being the active tab and on
not having already read that same comparison. Without the gate a restored session of diff tabs ran a
`git diff` each at boot, none of them being looked at.

## Coming back after the browser tab is closed

The strip is remembered in `localStorage` under `zasper.tabs`, following the theme and zoom precedent:
it belongs to the window looking at the project, not to the project.

```jsonc
{
  "version": 1,
  "directory": "/Users/x/work/demo", // absolute, from GET /api/info
  "active": "notes.txt", // a tab key, or "Launcher"
  "tabs": [{ "type": "file", "path": "notes.txt", "name": "notes.txt", "extension": "txt" }],
}
```

An **array**, because order is the whole point of remembering, and object key order is not a contract
— a file named `123` would be hoisted to the front of the strip on every restore.

**Restoring happens at module load.** `fileTabsAtom`'s initial value _is_ the restored strip, the way
`zoomLevelAtom` reads its stored level, and `App.tsx` mounts a bare `<Provider>`, so the strip is
painted in the first render before any request goes out.

That means the seed is **optimistic**: nothing at import time knows which project this server serves,
since that takes `/api/info`. `useRememberTabs` confirms it afterwards — on its first run with a
directory in hand it compares that against the directory the record was written for, and drops the
strip if they differ. Two projects served on the same port are the same origin, so the same storage,
and the absolute path is what tells them apart; `project` from `/api/info` is only the last segment,
so `/a/work/demo` and `/b/other/demo` are both `DEMO`.

Nothing is written while the directory is unknown, so a boot whose `/api/info` never answers leaves a
good record untouched rather than replacing it with a strip nobody confirmed.

**What is deliberately not remembered**, and why:

| Not remembered  | Why                                                                                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminals       | A shell cannot be reattached — every connection to `/ws/terminals` spawns a new one, and scrollback is not kept. A restored terminal would be an empty shell wearing an old name, and the name is what the Jupyter panel's shutdown decides by. |
| The Launcher    | It is the default state and has to exist whatever is stored. Only its being in front round-trips.                                                                                                                                               |
| `load_required` | A pulse, not a property.                                                                                                                                                                                                                        |
| `kernelspec`    | It goes stale, and the kernel already running that path outranks it anyway.                                                                                                                                                                     |
| Unsaved edits   | They live in the editors' own state. A restored tab is the file as it is on disk.                                                                                                                                                               |

A strip is capped at 25 tabs, since every one of them is mounted. Two windows on one server both write
the key and the last writer wins; that is felt only at the next boot, which restores whichever window
last changed its strip.

## Closing, unsaved work, and stale paths

The × asks first when a tab is unsaved: `unsavedTabsAtom` is what the strip reads to draw the dot and
to know whether to raise the dialog, and "Save" runs the editor's own save function before closing.

A restored tab can name a file that has since been deleted, which used to be a quiet hazard: the read
rejected unhandled, the editor stood there looking like an empty file, and saving it wrote the deleted
file back to disk. Both editors now show the server's own sentence instead of an editor, register
nothing as unsaved, and refuse the save — so a tab pointing at nothing cannot create it.

## Kernels and terminals, across a reload

A reload loses no kernel. `closeTab` leaves it running, and a notebook tab that is reopened or restored
rejoins the session found by path (`sessionForPath`), with everything still in memory — which is why a
restored notebook needs nothing remembered but its path. ipywidgets go further and ask the kernel for
their state again; see [../widgets/README.md](../widgets/README.md).

Terminals are the opposite, and the reason they are not restored: a reload leaves the old shells
running and listed by `GET /api/terminals`, reachable from the Jupyter panel, but no tab can reattach
to one.

## Not implemented

- **No reordering.** No drag and drop, no move-tab command. Order is the order tabs were opened in,
  and a restored strip keeps it.
- **No "reopen closed tab", and no recent-files list.**
- **No cursor or scroll position**, and no unsaved buffers, across a reload.
- **No syncing between two open windows.** Neither sees the other's strip until the next boot.
- **One project remembered.** Alternating between two projects on the same port loses the other's
  strip each time. The record nests inside a map keyed by directory if that becomes worth it.
- **Nothing server-side.** The strip does not follow the project to another browser or machine, which
  is what putting it in `~/.zasper/config.json` would buy — at the price of hardening that file's
  writer, which is neither atomic nor locked.
