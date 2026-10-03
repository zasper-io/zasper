# Notebook diffs

A notebook changed in git is compared as cells, not as JSON. Each cell that changed is a card: its
source as a line diff, its outputs, and its metadata. Cells nobody touched fold away, a moved cell
reads as moved, and a notebook that was only run again says so.

This page is how that works, for anyone changing the git panel's diff or the notebook format code.

## What a reader sees

Opening a changed `.ipynb` from the git panel — unstaged, staged, or in a commit from the history —
opens its diff in a tab.

- **A summary line**: how many cells changed, counted by what happened to them (edited, added,
  removed, moved), and in how many the outputs and the metadata changed. The colours are the git
  panel's: modified, added and deleted, and moved in the accent.
- **A card per changed cell**, its left edge in the change's colour. The head says where the cell is on
  each side — `4 → 5`, `· → 7` for an added cell, `6 → ·` for a removed one — its type, and in words
  what changed.
- **The source** is one column of lines with both sides' line numbers. A changed line marks the whole
  words that changed inside it: `1min` against `5min`, `mean` against `median`.
- **Outputs** start open under the source, with a line naming what changed. Printed text — a stream,
  an error, a `text/plain` result — is a line diff like the source; anything else is rendered on both
  sides, side by side, with the notebook's own output renderer. An added or removed cell's outputs are
  shown on their one side.
- **Metadata** is one line naming the keys that changed, and opens to a line diff of them.
- **Unchanged cells** fold into one line per run of them, which opens to show them.
- **The notebook's own metadata**, when it changed — a different kernel, say — is a card of its own at
  the top.

Two switches in the tab's strip close every output change and open every metadata change at once. A
notebook run again with nothing edited says _Only outputs changed_; one with nothing changed at all
says _No changes_.

## Matching the cells

Which cell on one side is which on the other is the whole problem; everything after it is an ordinary
diff. It is decided in `matchCells` in
[cellDiff.ts](../ui/src/ide/editor/notebookDiff/cellDiff.ts).

- **By id.** From nbformat 4.5 every cell has an id, and the same id on both sides is the same cell
  wherever it went. Used whenever every cell on both sides has one and none repeats.
- **By source**, for an older notebook, the approach nbdime takes:
  1. Cells with identical sources are paired in order, as anchors, by a longest common subsequence.
  2. Between each two anchors, each leftover cell on the old side is paired with the most alike cell of
     the same type on the new side, if they are at least half alike — the share of lines in common, or
     of characters for one-line cells.
  3. A leftover removed cell and a leftover added cell with the same source are one cell that moved.
- **Moved** is a matched cell outside the longest run of cells that kept their order. A removed cell
  is placed after the nearest earlier cell that stayed where it was.

Anything matched to nothing is added or removed.

## What is not a change

- **Execution counts**, on a cell and on an `execute_result`. Every run renumbers them, and counting them
  makes every re-run look like an edit.
- **Metadata a frontend writes for itself**: `collapsed`, `scrolled`, `execution` and `ExecuteTime`.
- **Zasper's own `application/vnd.zasper.dataframe+json`** on a DataFrame output, whose id is new every
  time a frame is displayed (see [DATAFRAMES.md](DATAFRAMES.md)).

Everything else in a cell's outputs and metadata is compared as JSON with its keys sorted.

## Where the work is done

| Piece | Where |
| --- | --- |
| Reading both sides | `getDiff` in `internal/gitclient/diff.go` |
| Matching and line diffs | `ui/src/ide/editor/notebookDiff/cellDiff.ts` |
| The cards | `ui/src/ide/editor/notebookDiff/NotebookDiff.tsx` and `NotebookDiff.scss` |
| The tab and its switches | `ui/src/ide/editor/DiffTab.tsx` |

The server reads both sides of the comparison as it does for any file, and for a notebook adds each
side's cells — source, outputs, metadata and id, as `internal/nbformat` reads them — under `notebook`
in `/api/git/diff`'s answer (see [API.md](API.md)). The browser matches them and draws the line diffs,
with the word marks taken from `@codemirror/merge`'s character diff and widened to whole words.

The answer still carries both sides' cell sources flattened into one text, which is what a notebook
that cannot be read as cells falls back to: a merge conflict left in the JSON, say. That and any other
file are drawn in the side-by-side MergeView a file always gets. A side over 2 MB is not sent at all.

## Not done

- **Merging.** A conflicted notebook is compared, not resolved; a three-way merge would hang off the
  same cards.
- **Structure inside an output.** A changed output is shown on both sides, not diffed key by key.
