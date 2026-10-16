# Changelog

All notable changes to Zasper are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Zasper follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] — 2026-10-16

2.1.0 brings coding agents into Zasper. The agent you already use — Claude Code, Gemini CLI or Codex —
works in a panel beside your notebooks, can read, edit and run them through Zasper's own tools, and
every change it makes can be reviewed and undone. Underneath that, a notebook now takes changes made to
its file while it is open, cell by cell, and a run started anywhere reaches its cell. There is also a
variables panel with a data grid that turns into a chart, SQL cells, a notebook diff, and folders that
run nothing until you trust them.

### Upgrading from 2.0.0

- **A folder runs nothing until you trust it.** The first time you open a folder, Zasper asks whether
  you trust its authors. Until you do, it is restricted: every file and saved output can be read, but
  no kernel, `.venv`, language server that runs code or git hook starts. A folder you trust is
  remembered. `zasper --trust` trusts the folder for one run, which is what a script or a server you
  run unattended wants. [docs/TRUST.md](docs/TRUST.md) has the whole table.
- **The watch socket says which files changed.** `/api/contents/watch` sends
  `{"changed": [{"path", "hash"}]}` where it sent the bare string `reload`, which it now sends only
  when too many files changed at once to list. A script that waited for `reload` should treat any
  message as a change. See [docs/API.md](docs/API.md).
- **A save can be refused.** `PUT /api/contents` takes the `hash` a read served, and answers `409` when
  the file has changed since, rather than writing over it. A save without a `hash` writes as before.

### Added

**Coding agents** — see [docs/AGENTS.md](docs/AGENTS.md) and [docs/MCP.md](docs/MCP.md)

- **The agent panel**, on the right of the editor. Start Claude Code, Gemini CLI, Codex or any agent that
  speaks the Agent Client Protocol; those not installed show the command that installs them. The
  conversation is kept on the server, so a reload or a second tab shows it, and an agent's past
  conversations in the project can be opened again.
- **Zasper's tools for every agent**, over MCP: list, read and edit notebooks cell by cell, run a cell,
  run all, run code to inspect a kernel, list variables and describe a DataFrame. `zasper mcp` gives
  the same tools to an agent that runs on its own, in a terminal.
- **Permission modes**: ask every time, allow edits, or allow edits and commands.
- **Commands the agent runs** show their output and exit code in their row, live where the agent lets
  Zasper run them.
- **Review and undo a turn.** The files a turn changed are listed under it. Each opens a diff, with an
  undo for every changed block, or for every changed cell of a notebook; a file, or the whole turn, can
  be undone at once. Edits, commands and notebook tools all count, whoever made them.
- **Mentions.** `@` finds a file, including one `.gitignore` leaves out, and a cell's menu adds the
  cell or its output to the next message, unsaved edits included.
- **A cell an agent ran or edited** carries its mark, and its name while it runs.

**Notebooks**

- **A notebook takes changes made to its file while it is open**, cell by cell. A cell you are typing
  in is left until you leave it, and a cell both sides changed asks which to keep, on the cell.
- **A run started anywhere reaches its cell**: from another tab, from an agent, or with no tab open at
  all. Output is kept on the server and replayed into a tab that opens later, and `input()` waits for a
  tab to answer it.
- **A notebook diff**, cell by cell, with outputs and metadata, for git's changes and a file changed on
  disk.
- **Run time** beside each cell, and its run button and execution count always shown side by side.
- **Outputs**: `text/markdown`, GIF, WebP and PDF.
- **A notebook naming no kernel** starts one for the language it is written in, and cells take their
  language from the running kernel.
- **A dead kernel says why**, with the last lines it printed.

**Data**

- **A variables panel** for the running kernel, and a data grid for a DataFrame: hide, move and resize
  columns, export the ones you choose to CSV, and turn the grid into a chart — and the chart into the
  code that draws it.
- **Compact DataFrame grids in cell output**, with each column's statistics on hover.
- **SQL cells** on connections Zasper manages, whose result is a DataFrame the next cells can use.
  Interrupt cancels a running query.
- **Each kernel's memory and GPU memory**, shown as it runs.

**Kernels and languages**

- **Kernels in any conda environment** are found, and a kernelspec's `{connection_file}`,
  `{resource_dir}` and `{prefix}` are filled anywhere in its command, as Jupyter fills them.
- **Language servers for Java, Scala, Kotlin, C#, shell, SQL and Haskell.**
- **The launcher groups a language's kernels** when it has several.
- **Windows**: interrupting a kernel works, and stopping one stops everything it started.

**And**

- **What's new**, as a tab after an upgrade.

### Changed

- **Usage data counts the new features**: the agent panel, Zasper's MCP tools, folder trust, SQL
  cells, charts, changes resolved against disk and diffs, by kind and in buckets, never by name or
  content. [PRIVACY.md](PRIVACY.md) lists every event and every value it can carry, and turning usage
  data off turns them off too.
- **The status bar takes the theme's hue** in dark themes.
- **More room between cells**, and Shift-Enter keeps the next cell in view.

### Fixed

- A notebook's kernel no longer imports modules that happen to sit beside the notebook as it starts.
- Run All no longer sends a cell before the SQL cell above it has finished.
- A display updated in place shows its latest frame, live and replayed.
- A kernel slow to start is waited for however long it takes, not 30 seconds.
- A run the kernel aborted ends cleanly, and is saved even when nobody saw it end.
- A notebook's control messages reach a busy kernel.
- A cell whose kernel died before answering shows no execution count, and saves none.
- A conda kernel's command runs from its own environment.
- Connection files left by a server that was killed are cleaned up by the next one.
- A markdown output's prose is no longer drawn as a table's row count.
- C and C++ notebooks no longer get errors from clangd, which reads a cell as a whole file.

## [2.0.0] — 2026-09-22

2.0.0 is a major release because two parts of the documented API changed
incompatibly, both as part of moving the browser's session into an `HttpOnly`
cookie. The main reason is security: a session token in a URL leaks. The app
itself upgrades without any action. Scripts that talk to Zasper's API should
read the first two items below.

### Upgrading from 1.1.0

- **WebSocket routes no longer accept `?token=<jwt>`.** A token in a URL ends up
  in server and reverse-proxy access logs, browser history and error reports,
  and whoever reads it there holds a live session for up to 24 hours. The server
  now never reads a session from a URL. A script that opens
  `/ws/kernels/{id}/channels` or `/ws/terminals/{id}` sends
  `Authorization: Bearer <jwt>` on the upgrade instead; the browser uses its
  cookie. [docs/API.md](docs/API.md#removed-in-200) has the details.
- **`protected` is no longer in `/api/config` or `/api/info`.** It has been
  `true` on every server since 1.1.0. Treat a missing field as `true`.
- **You will be asked to sign in once.** The browser's session is now an
  `HttpOnly` cookie, which no script in the page can read, instead of a token
  kept in the page's storage.
- **A notebook's kernel starts in the notebook's folder**, not the folder Zasper
  was started in, so a relative path in a cell means what it means beside the
  file, as in Jupyter. `JPY_SESSION_NAME` is set to the notebook's path. Code
  that opened files relative to the project root from a notebook in a subfolder
  needs its paths adjusted.
- **HTML outputs saved in a notebook no longer run their scripts when it is
  opened.** They are sanitised, because the scripts would run as you. Outputs
  from cells you run in this session still run theirs. Re-run a cell to bring
  back an interactive plot, such as Bokeh or Plotly, that was saved in the file.
- **A server bound to `127.0.0.1` or `localhost` answers only to a localhost
  address.** A request that names the server by another hostname gets `403`.
  This closes DNS rebinding. If a reverse proxy on the same machine serves
  Zasper under a name of its own, name it with `--allow-host` or
  `ZASPER_ALLOWED_HOSTS`, for example `--allow-host=zasper.example.com`.
  Rewriting the proxy's `Host` header to `localhost` does not work, because
  WebSockets and saves check that the browser's `Origin` matches `Host`.
- **Request bodies are capped**, at 512 MiB for the API (uploads excepted) and
  16 KiB for sign-in.

### Added

- **`--allow-host` and `ZASPER_ALLOWED_HOSTS`**, the other host names a
  loopback-bound server answers to, for serving Zasper behind a reverse proxy.
  Each takes a comma-separated list of names, without a scheme or path.
- **Language servers.** Diagnostics, completion, hover, go to definition, find
  references, rename, document symbols, inlay hints and format on save, for
  Python, Go, JavaScript and TypeScript, Rust, C and C++, R and Julia. Zasper
  starts a server already installed on your machine, and Settings says which one
  it found or how to install one. Notebooks get them too, with IPython magics
  masked out and imports resolved against the kernel's interpreter. See
  [docs/LANGUAGE-SERVERS.md](docs/LANGUAGE-SERVERS.md).
- **Search across the project**, with replace, a preview of each file's changes
  and the matches in unsaved editors included. It uses ripgrep when it is
  installed and gives the same answers without it.
- **Find and replace in a notebook**, across cells and outputs.
- **Export a notebook** as an HTML page, Markdown or a script.
- **A table of contents** beside a notebook's cells, built from its headings.
- **Command and edit modes in notebooks**, with Jupyter's keys.
- **Choose a Python interpreter** in the top bar, the status bar or Settings,
  and **run a Python file** in the terminal with it.
- **A terminal panel** below the editor, with a toggle command.
- **Editor settings:** autosave, format on save, tab size and tabs or spaces,
  whitespace, rulers, word wrap, line numbers, font size, trimming trailing
  whitespace, a final newline, and Vim or Emacs keys. `.editorconfig` files are
  honoured.
- **The status bar** shows and changes a file's language, indentation and line
  endings.
- **Go to line** and **recent files** in the command palette. Recent files and
  open tabs are remembered per project.
- **A file changed on disk updates its editor**, and your unsaved edits are kept.
  You can compare the edits with the version on disk.
- **A Settings switch for loading widget libraries from the CDN.** Libraries
  that Zasper does not bundle are loaded from jsDelivr; turn this off to keep a
  notebook's widgets from reaching the network.
- A notice when your session ends or the server stops, saying which it was.
- The startup banner is in colour.

### Changed

- **Stopping a kernel asks it to shut down** instead of killing it, so its
  `atexit` handlers run. One that has not exited after five seconds is sent
  SIGTERM, then killed. On macOS and Linux the signals go to the kernel's whole
  process group, so processes it started stop with it.
- A kernel accepts more than one connection at a time, so reloading the page
  while a notebook is open no longer loses track of how many are attached.
- Switching themes no longer animates every colour on the page.
- Terminals are no longer offered on Windows, where they have never worked. Run
  Zasper under WSL to use one.

### Fixed

- A kernel that failed to start left its connection file, including the kernel's
  signing key, in Jupyter's runtime folder.
- Saving a file reset its permissions: a `0600` file became readable by others,
  and a script lost its execute bit.
- Saving a file that is a link replaced the link with a plain file.
- A delete request naming the project folder itself, as an empty path, `.` or
  `/`, emptied the project. It is now refused.
- On Windows, language servers installed in a project's `.venv` were not found,
  and changes inside ignored folders such as `node_modules` reloaded the page.
- Notebooks with Plotly, Vega or other `application/*+json` outputs were
  reported as not matching nbformat's schema.

## [1.1.0] — 2026-09-14

### Upgrading from 1.0.0

- **Every server now requires the access token.** Protected mode is always on.
  `--protected` is still accepted, so scripts that pass it keep starting, but
  `--protected=false` is ignored with a warning. A client that called the API
  without credentials has to exchange the access token at `/auth/login` first, as
  [docs/API.md](docs/API.md#authentication) describes.
- **`ZASPER_JWT_SECRET` has been removed.** Sessions are signed with a key derived
  from the access token. If you set `ZASPER_JWT_SECRET` to keep sessions valid
  across restarts, set `ZASPER_ACCESS_TOKEN` to a fixed token instead. Changing
  that token signs everyone out.
- **Zasper opens your browser on startup**, already signed in. It does this only
  when it is running in a terminal: never for JSON output, and on Linux only when
  `DISPLAY` or `WAYLAND_DISPLAY` is set, so an SSH session is left alone. Pass
  `--no-browser` to turn it off.

### Added

- **`ZASPER_ACCESS_TOKEN`**, to fix the access token instead of generating a
  random one on every start.
- **A sign-in link.** The startup banner prints `/?token=…`, which signs a browser
  in and removes the token from the address bar, as Jupyter's link does. The
  login page now says why a sign-in failed and can show the token as you type it.
- **Setting up a Python kernel from the Launcher.** When no kernel is installed,
  the Launcher can create a `.venv` in the project, install `ipykernel` into it
  (with uv when uv is available) and offer it as a kernel. It never installs
  anything into a system or Homebrew Python.
- **Kernels from the Microsoft Store's Python on Windows**, which were listed by
  `jupyter kernelspec list` but not found by Zasper.
- **More notebook outputs:** `text/latex` (SymPy, and IPython's `Latex` and
  `Math`), SVG and JPEG.
- **A PDF viewer**, with a download button.
- **Markdown files** open with Edit, Preview and Side by side views.
- **A Help tab** that lists every command and its shortcut, with a filter and an
  About section. It replaces the Help dialog.
- **A context menu on tabs**, with Close, Close Others, Copy Path and Reveal in
  File Explorer. Closing several tabs asks about their unsaved changes in one
  dialog.
- **Open tabs are remembered for each project** and come back on reload. Each tab
  loads when you switch to it.
- **Toggle Sidebar**, in the topbar and on the keyboard. While a terminal has
  focus, app shortcuts on chords the shell uses, such as Ctrl-B and Ctrl-K, go to
  the shell instead.
- Tooltips on icon buttons.
- `/api/info` reports the project's `directory` and the server's `arch`.

### Changed

- **Kernelspecs are answered in Jupyter Server's model**, with `env`, `metadata`
  and `interrupt_mode` always present. Resource URLs point at Jupyter's
  `/kernelspecs/{kernel}/{resource}`; the old `/static/kernelspecs/…` address
  still works.
- `GET /api/kernelspecs/{kernelName}` and `POST /api/sessions` return `404` for a
  kernel that is not installed, instead of an empty spec or a `500`.
- Zasper's license is now stated precisely as `AGPL-3.0-only` in the Homebrew
  cask, the snap and the README. The README describes the commercial license
  option. Contributions now need the [Contributor License Agreement](CLA.md),
  which a bot asks for on your first pull request.
- Building from source reads the required Node.js version from `.nvmrc`, and
  `make` stops with a clear message when your Node.js is too old.

### Fixed

- Opening any file made the whole window scrollable, so the IDE slid out of
  view.
- A terminal did not resize to its pane after you switched back to its tab.
- Closing a tab behind the active one changed the active tab.
- Undo right after a file loaded could empty the editor.
- Closing a notebook while its kernel was still connecting left that connection
  open until the page was closed.

## [1.0.0] — 2026-09-10

The first stable release. Zasper's HTTP and WebSocket API, its configuration
file and its command-line flags are covered by semantic versioning from this
point on: they will not break within 1.x.

### Upgrading from 0.2.0-beta

Three changes need attention if you have Zasper running somewhere:

- **The server now binds `127.0.0.1` by default** instead of every interface. If
  you reach Zasper from another machine, start it with `--host=0.0.0.0`, and turn
  on `--protected=true` at the same time. An unprotected server exposes your
  project files and an interactive shell to anyone who can reach the port, which
  the old default did silently.
- **`DELETE /ws/kernels/{kernel_id}` has been removed.** It was undocumented and
  duplicated `DELETE /api/kernels/{kernelId}`, which is unchanged and is what you
  should call.
- **Kernel connection files moved** from the system temp directory to
  `~/.zasper/runtime`, and are now created `0600` and deleted when the kernel
  stops. Nothing needs to change unless you had tooling reading them out of
  `/tmp`.

### Added

- **Source control.** A Git panel with real status, staging, discard and
  staged-only commits; branch create, switch and delete; remote sync; a readable
  history; side-by-side diffs; and `git init` for a plain folder. Git commands
  are available from the command palette.
- **Notebook outputs.** ipywidgets rendering, Plotly figures, GitHub Flavored
  Markdown with tables, and LaTeX in markdown cells via KaTeX.
- **Notebook editing.** Cell reordering with keyboard shortcuts and focus
  management, insert options and context menus, autocompletion, and an unsaved
  changes dialog when closing a tab.
- **nbformat handling.** Notebooks in formats 2 and 3 are converted to 4.5 on
  read; 4.x files keep their own minor version on save; a notebook round-trips
  byte-for-byte with what Jupyter would have written.
- **Terminals.** A terminal management API and UI, with terminals opening in the
  project directory.
- **A command palette** unifying file search and commands, built on a command
  registry that also generates the in-app key bindings list.
- **Theming.** Nine themes built from a single design-token layer, selected by
  `data-theme`, plus application-wide zoom.
- **Protected mode.** JWT authentication over REST and WebSocket routes, with a
  same-origin check on upgrades.
- **Anonymous usage data**, off with `--tracking=false` or `ZASPER_TELEMETRY=0`,
  documented event by event in [PRIVACY.md](PRIVACY.md).
- **`--version`**, which prints the version and exits.
- **`--host`**, which chooses the interface to bind.
- **`ZASPER_LOG_FORMAT`** to force console or JSON logging, and
  **`ZASPER_ACCESS_LOG=1`** to log every served HTTP request.

### Changed

- **Structured logging throughout.** A terminal gets human-readable console
  output; a pipe or a log collector gets JSON. Caller paths are repo-relative
  rather than absolute build-machine paths, and a kernel's own stdout and stderr
  are drained through the logger at debug rather than printed raw into the
  server's output.
- **Quieter by default.** Requests that succeed, and routine kernel and session
  bookkeeping, log at debug. Failures stay visible with no flag.
- **Notebook saves are atomic.** A save writes beside the file and renames over
  it, so a crash or a full disk can no longer leave a truncated notebook.
- **Kernel connection files** are `0600` in `~/.zasper/runtime` and are removed
  on shutdown.
- **CORS** is restricted to the Vite dev origins rather than a wildcard.
- The SPA fallback answers `200` rather than `202`.
- **Building from source needs Node.js 22.12 or newer**, up from 22.7. The
  patched `sanitize-html` loads `htmlparser2`, which is now ESM-only, and Node
  can only `require()` an ES module from 22.12. Prebuilt releases are
  unaffected.
- Releases are gated on the full test suite; before, a tag published whatever it
  pointed at without running anything.

### Security

- **`sanitize-html` 2.17.5 → 2.17.7**, fixing a mutation-XSS `allowedTags`
  bypass via a literal `</textarea/>` solidus close, and a stored XSS where an SVG
  SMIL `values=` list carried a `javascript:` URI past the scheme policy. It ships
  to users: `@jupyter-widgets/base-manager` uses it to sanitize widget HTML.
- **`browserslist` 4.28.1 → 4.28.9** and **`baseline-browser-mapping` 2.10.0 →
  2.11.21**, fixing a prototype write and a denial of service. Both are
  build-time only and never reach the shipped bundle.

### Removed

- **The Electron desktop application.** Zasper is distributed as a local server
  you open in a browser.
- Bootstrap, in favour of the design-token layer.
- `DELETE /ws/kernels/{kernel_id}` — see *Upgrading* above.

### Fixed

- A race in the file browser's upload queue and tree root handling.
- Kernel port allocation, which leaked ports until a long-running server refused
  to allocate.
- Sessions outliving their kernel, and sessions not following a renamed notebook.
- The watch WebSocket returning 401 in protected mode, which no browser could
  satisfy because it cannot set headers on a WebSocket.
- A path-traversal hole in kernelspec resource serving.
- An authentication issue where the JWT secret was not randomized.
- The startup banner claiming success before the port was actually bound.

## [0.2.0-beta] — 2025-06-10

Pre-release.

## [0.1.0-alpha] — 2025-05-23

First public pre-release.

[2.0.0]: https://github.com/zasper-io/zasper/releases/tag/v2.0.0
[1.1.0]: https://github.com/zasper-io/zasper/releases/tag/v1.1.0
[1.0.0]: https://github.com/zasper-io/zasper/releases/tag/v1.0.0
[0.2.0-beta]: https://github.com/zasper-io/zasper/releases/tag/v0.2.0-beta
[0.1.0-alpha]: https://github.com/zasper-io/zasper/releases/tag/v0.1.0-alpha
