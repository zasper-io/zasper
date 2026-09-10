# Changelog

All notable changes to Zasper are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Zasper follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-10

The first stable release. Zasper's HTTP and WebSocket API, its configuration
file and its command-line flags are covered by semantic versioning from this
point on: they will not break within 1.x.

### Upgrading from 0.3.0-beta

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

## [0.3.0-beta] — 2026-02-15

Pre-release. See the
[release notes](https://github.com/zasper-io/zasper/releases/tag/v0.3.0-beta).

## [0.2.0-beta] — 2025-06-10

Pre-release.

## [0.1.0-alpha] — 2025-05-23

First public pre-release.

[1.0.0]: https://github.com/zasper-io/zasper/releases/tag/v1.0.0
[0.3.0-beta]: https://github.com/zasper-io/zasper/releases/tag/v0.3.0-beta
[0.2.0-beta]: https://github.com/zasper-io/zasper/releases/tag/v0.2.0-beta
[0.1.0-alpha]: https://github.com/zasper-io/zasper/releases/tag/v0.1.0-alpha
