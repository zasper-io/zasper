# DataFrames and variables

Zasper reads tables out of a running Python kernel rather than out of the HTML a library printed: a
cell's DataFrame output pages, sorts and filters in place, any variable can be opened as a table in a
tab, and the Variables panel lists what the kernel holds. Everything is computed in the kernel, so a
million-row frame is never sent to the browser to be sorted.

This page is how that works, for anyone changing the kernel helper, the API or the grid.

## What there is

- **A cell's output.** A DataFrame or Series a cell displays is a grid while the kernel that printed it
  still holds it: ten rows a page (or 25, or 100), a distribution and missing share in each column's
  header, a column menu with sort, filter and summary statistics, filter chips, copy or download as
  CSV, and Open in a tab. Once the kernel has let the frame go — after a restart, or when the notebook
  is opened cold — the output is pandas' own HTML, with one line under it saying so.
- **A tab.** The same grid, scrolling instead of paging. It opens from a cell's output (named
  `Out[n]`, keeping the filters, sort and column layout it had) or from a variable in the Variables
  panel, and is read again after each run of its notebook. Its scrollbar spans the whole filtered frame
  and it draws only the rows in view: pages of 100 are read as they come into view and at most 30 are
  kept, so jumping to row 900,000 of a million costs two pages, not nine thousand.
- **In either:** click a cell and Mod-C copies its value as the kernel sent it, unrounded; the arrow
  keys move the selection. A column's menu hides it or moves it left or right, a header can be dragged
  onto another, and its right edge drags it wider or narrower. Copy and Download as CSV export the
  columns as they are arranged, hidden ones left out.
- **The Variables panel**, in the dock under the editor: each name the kernel holds with its type,
  size and a short summary. A table-like one opens in a tab.

Python kernels only. Any other kernel answers `422`, and the panel says why.

## How it works

| Piece | Where |
| --- | --- |
| The kernel helper | `internal/kernel/inspect.py`, embedded in the binary |
| Asking the kernel | `internal/kernel/inspect.go` |
| The API | `internal/kernel/kernel_api_handler.go`, documented in [API.md](API.md) |
| The grid | `ui/src/ide/variables/DataGrid.tsx`, one component for the cell and the tab |
| A cell's output | `ui/src/ide/editor/notebook/DataFrameOutput.tsx` |

**The helper never touches the user's namespace.** It is loaded as its own module,
`_zasper_inspect`, by a `silent` execute request with `store_history` off, and answers through
`user_expressions`: nothing is printed, the execution count does not move, and no name is added. The
server loads it as soon as a Python kernel first answers, and again with every question, so an
upgraded server never talks to an older helper.

**A cell's output keeps hold of its frame.** The helper registers an IPython display formatter. When a
DataFrame, Series or polars DataFrame is displayed it is kept under an id, and the output carries
`application/vnd.zasper.dataframe+json` (the id, the kind and the shape) beside pandas'
`text/html`. The saved file still holds pandas' table, so it reads the same in JupyterLab and on
GitHub. The kernel keeps the last 50 frames it displayed; one it has let go answers `410`, and the
output falls back to its HTML.

**Columns are named by position**, so a frame with duplicate or non-string column names can still be
sorted and filtered. Filters run first, then a stable sort, and the resulting row order is cached, so
paging through a sorted view does not sort again. Listing the variables, which happens after every
run, forgets the cache.

## polars

A polars DataFrame is read through pandas, so a kernel needs pandas for polars frames to be tables.

- **The conversion is made once.** The last polars frame converted is cached, so paging a large frame
  costs the conversion on the first page only (about 0.2s for two million rows) and nothing after it.
  Listing the variables forgets it, so a frame changed by a run is converted again.
- **pyarrow is not required.** polars' `to_pandas` needs pyarrow, which many polars installs do not
  have; without it the frame is converted column by column instead. Sorting, filtering, the profile
  and CSV behave the same either way.
- **Headers name polars' types** (`Int64`, `String`), not the pandas types the frame was converted to.
  An integer column with nulls arrives as floats, as pandas holds it, and the grid prints whole values
  without the `.0`.
- **Without pandas, a polars frame is not a table.** It is not offered as one in the Variables panel,
  and its output keeps polars' own HTML.

Tested on 3 October 2026 with polars 1.44 against pandas 3, with and without pyarrow, and with no
pandas at all.

## Limits

- **An output's table needs the kernel that printed it.** Run the cell again after a restart.
- **Filters, sort and column layout are not saved.** They live in the grid on screen and go with a
  reload.
- **CSV export carries at most 100,000 rows**, because the answer travels through the kernel's reply
  as one string. The toast says so when it is cut.
- **A busy kernel answers late.** A question waits behind a running cell, and after 10 seconds the
  grid or the panel says the kernel is busy.
