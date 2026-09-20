# Language servers

Zasper uses the Language Server Protocol for what an editor cannot work out on its own: errors as
you type, completion with documentation, hover, go to definition, find references, rename, quick
fixes, symbols and formatting. Both the file editor and notebook cells are served.

Zasper ships no language servers. It starts one you already have, and tells you when you have none.

## What you need

| Language | Server | Install |
| --- | --- | --- |
| Python | basedpyright, pyright or pylsp | `pip install basedpyright` |
| Go | gopls | `go install golang.org/x/tools/gopls@latest` |
| TypeScript, JavaScript | typescript-language-server | `npm install -g typescript-language-server typescript` |
| Rust | rust-analyzer | `rustup component add rust-analyzer` |
| C, C++ | clangd | `brew install llvm`, or your package manager |
| R | languageserver | `R -e 'install.packages("languageserver")'` |
| Julia | LanguageServer.jl | `julia -e 'using Pkg; Pkg.add("LanguageServer")'` |

For Python, whichever of the three is found first is used, in the order above. They are not
interchangeable: basedpyright and pyright are type checkers, while pylsp is jedi with a set of
plugins, so what Zasper can tell each one differs — see [What each server is
told](#what-each-server-is-told).

**Where Zasper looks.** `PATH` first, then the project's `.venv/bin`, `venv/bin`,
`node_modules/.bin`, `$GOPATH/bin`, `~/go/bin`, `~/.cargo/bin`, `~/.local/bin`, `~/.juliaup/bin`
and Homebrew. That list exists because an app started from the Dock has a thinner `PATH` than your
shell: `gopls` in `~/go/bin` would otherwise look uninstalled.

## The status bar tells you where you stand

The item at the right of the status bar names the server for the file or notebook in front, with a
dot for its state: starting, ready, failed, or stopped. Its menu restarts the server, shows what it
has written to standard error (**Show log**), stops it, and — for Python — names **the interpreter
the server reads imports with**. When nothing is installed the item says *No server* and the menu
gives the command to install one.

The counts beside it are the problems in the project; pressing them opens the Problems panel under
the editor.

## How a problem is shown

An error or a warning is a squiggle under the code in the severity's colour, a mark in the gutter
beside the line, a row in the **Problems** panel under the editor, and a number in the status bar. A
notebook's rows name the cell: `analysis.ipynb cell 3, 2:5`. Pressing a row opens the file, or the
cell, with the cursor on the problem.

Some things a server reports are not faults: an unused import, an unreachable branch. Those arrive
tagged, and are drawn as **faded text** — no squiggle, and nothing in the gutter — which is how every
other editor draws them. They are still listed in the Problems panel, and they are not counted in
the status bar.

## Settings

**Settings → Language servers**:

- **Use language servers** — off starts nothing at all.
- **Type checking** (Python) — pyright's own modes: `off` (the default), `basic`, `standard`,
  `strict`. Changing it takes effect at once, with no restart.
- **A command per language** — for when discovery finds the wrong server, or none. Write the
  command you would type in a shell.

A project's own configuration wins over the Type checking setting: a `pyrightconfig.json`, or
`[tool.pyright]` / `[tool.basedpyright]` in `pyproject.toml`, is read by the server itself.

### Which mode to choose

Measured on a file that imports a module which does not exist, prints a name that was never defined,
and uses scikit-learn correctly:

| Mode | Undefined names, missing imports | A correct line using an untyped library |
| --- | --- | --- |
| `off` (the default) | reported | quiet |
| `basic` | reported | reported |
| `standard` | reported | reported |
| `strict` | reported | very loud |

`off` is the default because it is what VS Code shows with its own default settings, and because the
stricter modes call correct code wrong. pyright's own `off` reports nothing whatsoever — not even an
undefined name — so Zasper's `off` keeps three rules on: undefined names, imports that cannot be
found, and a module whose stubs are missing. That is the set Pylance keeps.

The cost of the stricter modes is libraries that publish no type information: the checker reads the
library's source, infers a type it cannot narrow, and faults an attribute that is there at runtime.
scikit-learn is the common example — in `standard`, `load_iris(as_frame=True).frame` is reported
although it works. Choose `basic` or `standard` for code you maintain and have types for; silence a
single line with `# type: ignore[attr-defined]`.

### What each server is told

| | basedpyright, pyright | pylsp |
| --- | --- | --- |
| The kernel's interpreter | `python.pythonPath` | `pylsp.plugins.jedi.environment` |
| Type checking setting | applies | no effect — pylsp's checks are its own plugins (pyflakes, pycodestyle), configured in pylsp's own configuration |
| How it learns | it asks, and is told again when the setting changes | it never asks, so Zasper pushes the settings once it is up |

Both are given the same interpreter, in the shape each understands. Measured against pylsp 1.15:
without it, `pd.read_c` in a cell offers nothing at all; with it, `read_csv` and `read_clipboard`.

## Notebooks

A notebook's cells are given to the server as one document, so a name defined in one cell is known
in the next. Two things follow.

**IPython is not Python.** A line magic, a `!` shell escape and `obj?` are replaced before the
server sees them, line for line, so every line keeps its number: the server never reports them as
syntax errors, and never says anything about them either. `%%time` and its relatives hide only
their first line; `%%bash` and other cell magics hide the whole cell.

**The kernel's interpreter is used.** The server is told which Python the notebook's kernel runs, so
imports resolve against the environment the notebook actually executes in — not against whatever
`python` the server happens to find. This is why a notebook on a conda or uv environment resolves
its imports without any configuration.

A plain `.py` file has no kernel to ask, so it is read with the project's own environment — the
`.venv` or `venv` Zasper already offers as a kernel — and with the `python` on the `PATH` when the
project has neither. Once a notebook is open, its kernel's interpreter is used for the file editor
too: one server serves both.

### Completion in a cell

Two things know about a cell's code, and they know different things. The kernel knows what `df` is
right now, because it ran the cell that made it. The server knows the source, including cells that
have not run.

- **While typing:** the server alone, as in VS Code.
- **After a `.`, on Tab, and on Ctrl-Space:** both, merged. The kernel's names come first and win a
  name both offer; each row is tagged `kernel` or `source` so you can tell a name that exists now
  from one only the source defines.

The kernel is kept out of the typing path on purpose: it answers one request at a time, so asking
it on every keystroke queues behind a running cell.

**Shift+Tab** asks the kernel about the name at the cursor and shows its documentation in a card, as
Jupyter does. Hovering asks the server first, and the kernel only when it is idle.

### Format Cell and Format Notebook

Both are in the command palette; Format Cell is also `⇧⌥F`. Each cell is formatted on its own, so an
edit cannot reach across cells, and IPython's lines are put back untouched afterwards. Each cell's
result is one undoable edit.

basedpyright and pyright do not format. Zasper says so in a message when you ask. To format Python,
set a server that does under Settings → Language servers, such as `ruff server`.

## What is not there yet

- **One server per language per window.** Two notebooks on different environments share a server,
  and the interpreter is the one from the notebook that attached last; with no notebook open it is
  the project's own environment.
- **Rename inside a notebook**, and go to definition and signature help from a cell.
- **Semantic highlighting, call hierarchy and code lens.**

## When something looks wrong

- **`Import "pandas" could not be resolved`** — the server is reading a different Python than your
  kernel. Open the status bar item: it names the interpreter. If it says *No interpreter*, the
  notebook has no kernel attached yet, or its kernelspec names a command that cannot be found.
- **Squiggles under correct code, on library calls** — see [Which mode to
  choose](#which-mode-to-choose). A library with no type information is the usual cause.
- **Faded code, no squiggle and nothing in the gutter** — an unused import or unreachable branch.
  See [How a problem is shown](#how-a-problem-is-shown); nothing is wrong with the line.
- **The server keeps failing** — its menu's **Show log** has what it wrote to standard error.
- **Nothing at all** — check Settings → Language servers is on, and that the server for the language
  is installed.
