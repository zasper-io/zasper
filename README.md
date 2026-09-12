<p align="center">
  <img src="./assets/logo.svg" alt="Zasper">
</p>

<p align="center">
  <strong>A high-performance IDE for Jupyter notebooks.</strong><br>
  Any Jupyter kernel, one static binary, a fraction of JupyterLab's resource use.
</p>

<p align="center">
  <a href="https://github.com/zasper-io/zasper/releases"><img src="https://img.shields.io/github/v/release/zasper-io/zasper" alt="Latest release"></a>
  <a href="https://github.com/zasper-io/zasper/actions/workflows/gobuild.yml"><img src="https://github.com/zasper-io/zasper/actions/workflows/gobuild.yml/badge.svg" alt="Build status"></a>
  <a href="https://anaconda.org/conda-forge/zasper"><img src="https://img.shields.io/conda/vn/conda-forge/zasper" alt="conda-forge"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-blue" alt="License: AGPL-3.0-only"></a>
</p>

<p align="center">
  <a href="https://zasper.io/docs">Documentation</a> ·
  <a href="https://zasper.io/downloads">Downloads</a> ·
  <a href="#installation">Installation</a> ·
  <a href="https://join.slack.com/t/zasper/shared_invite/zt-30sx3uo8w-w~sw4Kje1aoUjxY5MZ_Fkg">Slack</a>
</p>

![Zasper running a Jupyter notebook](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/notebook.png)

## Overview

Zasper is an IDE for Jupyter notebooks, designed from the ground up for concurrency and a small
footprint. It implements [Jupyter's wire protocol](https://jupyter-client.readthedocs.io/en/latest/messaging.html),
so it runs any Jupyter kernel, and it reads and writes the `.ipynb` format directly, so notebooks
move between Zasper and JupyterLab unchanged.

Zasper is a single static binary with no runtime dependencies. It serves its interface to your
browser, on your own machine or on a server you share.

- **Notebooks** on any Jupyter kernel, with Plotly, ipywidgets, HTML and Markdown with LaTeX
  rendered inline. A save is byte-for-byte what Jupyter would have written.
- **Editor, terminal and version control** in the same window as your notebooks.
- **Command palette** that finds files and every command in one search.
- **Light and dark themes**, and window zoom.
- **Self-hosting** built in: every session is protected by an access token.

<details>
<summary>More screenshots</summary>

### Editor
![Editor](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/editor.png)

### Terminal
![Terminal](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/terminal.png)

### Launcher
![Launcher](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/launcher.png)

### Version control
![Version control](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/git.png)

### Command palette
![Command palette](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/commandPalette.png)

### Dark theme
![Dark theme](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/dark.png)

![Notebook in the dark theme](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/darkNotebook.png)

</details>

## Contents

- [Performance](#performance)
- [Installation](#installation)
- [Getting started](#getting-started)
- [Self-hosting](#self-hosting)
- [Jupyter kernels](#jupyter-kernels)
- [Notebook compatibility](#notebook-compatibility)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Configuration](#configuration)
- [Logging and privacy](#logging-and-privacy)
- [Architecture](#architecture)
- [Building from source](#building-from-source)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Community and support](#community-and-support)
- [Contributing](#contributing)
- [License](#license)

## Performance

In benchmarks against JupyterLab, Zasper uses:

- up to **5× less CPU**,
- up to **40× less memory**,

with higher throughput and lower latency, and it stays responsive under very high load.

![Resource use, Zasper compared with JupyterLab](https://raw.githubusercontent.com/zasper-io/zasper-benchmark/main/assets/summary_resources.png)

The methodology and full results are in the
[benchmark report](https://github.com/zasper-io/zasper-benchmark?tab=readme-ov-file#benchmarking-zasper-vs-jupyterlab).

## Installation

Current release version: `v1.0.0`

| Platform | Support |
| --- | --- |
| macOS | Supported |
| Linux | Supported |
| Windows | Binaries are published and Zasper runs, but the terminal and some kernel paths are less well exercised. For the best experience, use WSL. |

**Requirements.** Zasper runs notebooks on Jupyter kernels but does not install one:
`pip install ipykernel` is enough to start (see [Jupyter kernels](#jupyter-kernels)). You also
need a modern browser, since Zasper serves its interface locally rather than being a separate
desktop application. Without a kernel, Zasper still starts and the Launcher tells you what to
install.

### Homebrew

```sh
brew tap zasper-io/tap
brew trust zasper-io/tap
brew install zasper-io/tap/zasper
```

Homebrew 6 loads nothing from a third-party tap until you trust it, which is what `brew trust`
records. If you installed 0.x through Homebrew, run `brew uninstall zasper` first: from 1.0,
Zasper is published as a cask rather than a formula.

### Snap

```sh
sudo snap install zasper
```

<a href="https://snapcraft.io/zasper"><img src="https://snapcraft.io/en/light/install.svg" alt="Get it from the Snap Store"></a>

### conda

```sh
conda install -c conda-forge zasper
```

### Prebuilt binaries

Every [release](https://github.com/zasper-io/zasper/releases) ships a signed, notarized macOS
build and static binaries for Linux and Windows. The Linux archives are plain tarballs: one build
serves every distribution. There is no `.deb` or `.rpm` yet.

| Platform | Architecture | Archive |
| --- | --- | --- |
| macOS | Apple Silicon | `zasper-webapp-<version>-darwin-arm64.tar.gz` |
| macOS | Intel | `zasper-webapp-<version>-darwin-amd64.tar.gz` |
| Linux | x86-64 | `zasper-webapp-<version>-linux-amd64.tar.gz` |
| Linux | ARM64 | `zasper-webapp-<version>-linux-arm64.tar.gz` |
| Linux | i386 | `zasper-webapp-<version>-linux-386.tar.gz` |
| Windows | x86-64 | `zasper-webapp-<version>-windows-amd64.zip` |
| Windows | ARM64 | `zasper-webapp-<version>-windows-arm64.zip` |
| Windows | i386 | `zasper-webapp-<version>-windows-386.zip` |

Each release carries a `checksums.txt`. Verify a download with
`sha256sum -c checksums.txt --ignore-missing`. The same archives are listed on the
[downloads page](https://zasper.io/downloads).

### Docker

An image can be built from [`docker/`](docker/); see [docker/README.md](docker/README.md).

## Getting started

Run `zasper` in the directory you want to work in:

```console
$ zasper
==========================================================
     ███████╗ █████╗ ███████╗██████╗ ███████╗██████╗
     ╚══███╔╝██╔══██╗██╔════╝██╔══██╗██╔════╝██╔══██╗
       ███╔╝ ███████║███████╗██████╔╝█████╗  ██████╔╝
      ███╔╝  ██╔══██║╚════██║██╔═══╝ ██╔══╝  ██╔══██╗
     ███████╗██║  ██║███████║██║     ███████╗██║  ██║
     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝

                    Zasper Server
                Version: 1.0.0
----------------------------------------------------------
 ✅ Server started successfully!
 📡 Bound to:            127.0.0.1:8048
 🖥️  Webapp available at: http://127.0.0.1:8048
 🔐 Server Access Token: 14be1b674a3b9196a82c01129028d0dd
 🔗 Sign in with:        http://127.0.0.1:8048/?token=14be1b674a3b9196a82c01129028d0dd
 📊 Anonymous usage data: on  (--tracking=false to turn off)
                          see PRIVACY.md for what is sent
==========================================================
```

Zasper opens the **Sign in with** link in your default browser, so you arrive already signed in.
It does this on macOS and Windows, and on Linux when there is a display. Pass `--no-browser` to
leave the browser closed, for example on a machine you reach over SSH, and open the link
yourself.

## Self-hosting

Zasper always runs in protected mode: every route except the health check needs a session, and a
session comes from the access token printed at startup.

### 1. Start the server

```sh
zasper --host=0.0.0.0 --no-browser
```

`--host` makes the server reachable from other machines. Zasper binds `127.0.0.1` by default;
widen it only when you mean to. The banner then reports the wider binding:

```text
 📡 Bound to:            0.0.0.0:8048
 🖥️  Webapp available at: http://localhost:8048
 🔐 Server Access Token: 14be1b674a3b9196a82c01129028d0dd
 🔗 Sign in with:        http://localhost:8048/?token=14be1b674a3b9196a82c01129028d0dd
```

### 2. Sign in

On your own machine there is nothing to do: Zasper opens your browser already signed in.
Otherwise, sign in either way:

- **With the link.** Open the **Sign in with** link from the banner. It signs you in straight
  away, and the page removes the token from the address bar as soon as it has used it. Treat the
  link like a password.
- **With the token.** Open Zasper in a browser, which takes you to the sign-in page, and paste the
  **Server Access Token** there.

The banner's links say `localhost`, because they are written for a browser on the server itself.
From another machine, replace `localhost` with the server's hostname or IP address, for example
`http://my-server:8048/?token=…`.

When Zasper's output is not a terminal (under Docker, systemd, or piped to a file), it logs one
JSON line instead of the banner; the token is that line's `access_token` field.
`ZASPER_LOG_FORMAT=console` brings the banner back.

A session lasts 24 hours, after which you sign in again.

![The Zasper sign-in page](https://raw.githubusercontent.com/zasper-io/assets/refs/heads/main/login.png)

### 3. Keep the token across restarts (optional)

A new access token is generated every time the server starts, and open sessions are signed with a
key derived from it — so a restart both changes what you type and signs everyone out. Set the token
yourself to keep a link you have handed out working, and to leave signed-in browsers signed in:

```sh
export ZASPER_ACCESS_TOKEN=your-access-token
```

There is nothing else to configure: sessions follow the access token, and changing it signs everyone
out on purpose.

## Jupyter kernels

Zasper works with any kernel that implements the Jupyter protocol, including:

- Python, in any virtual environment, conda environment or uv project
- R ([IRkernel](https://github.com/IRkernel/IRkernel))
- Julia ([IJulia](https://julialang.github.io/IJulia.jl/stable/))
- Ruby ([IRuby](https://github.com/SciRuby/iruby))
- JavaScript and TypeScript ([Deno](https://docs.deno.com/runtime/reference/cli/jupyter/))
- Go ([GoNB](https://github.com/janpfeifer/gonb))

To see the kernels installed on your machine, run `jupyter kernelspec list`. The quickest way to
get a Python kernel is:

```sh
pip install ipykernel
```

### conda environments

```sh
conda create --name my-env -c conda-forge ipykernel
conda activate my-env
python -m ipykernel install --user --name=my-env
```

### uv projects

```sh
uv init my-project && cd my-project
uv add ipykernel
uv run python -m ipykernel install --user --name=my-project
```

Once registered, the environment appears in the Launcher and in each notebook's kernel picker.

## Notebook compatibility

Zasper reads and writes the `.ipynb` format directly. Two guarantees are worth stating outright:

- **A save produces no spurious diff.** A notebook Zasper opens and saves comes out byte-for-byte
  the file Jupyter would have written, so saving does not manufacture merge conflicts.
- **A file keeps its own nbformat minor version.** A 4.2 notebook is written back as 4.2 rather
  than silently upgraded to the newest revision, which is what JupyterLab does. Notebooks in
  formats 2 and 3 are converted to 4.5 on read.

### What renders

| Output | Status |
| --- | :---: |
| `text/plain`, stdout/stderr, tracebacks | ✅ |
| `text/html` | ✅ |
| `image/png` | ✅ |
| Plotly figures (`application/vnd.plotly.v1+json`) | ✅ |
| ipywidgets (`application/vnd.jupyter.widget-view+json`) | ✅ |
| `application/json` | ✅ |
| Markdown cells: GFM tables, task lists, raw HTML, LaTeX via KaTeX | ✅ |
| `image/svg+xml` | Not yet |
| `text/latex` | Not yet |
| `image/jpeg` | Not yet |

The three gaps are worth knowing before you hit them: `text/latex` is what SymPy emits from
`init_printing()`; `image/svg+xml` is what graphviz and networkx produce, and what matplotlib
produces under `%config InlineBackend.figure_format = 'svg'`; and `image/jpeg` covers `display()`
of a JPEG. Their cells run correctly; only the rendering is missing.

### Known limitations

- **Widget state is not written into the notebook.** Reopening a notebook without a running kernel
  shows a placeholder rather than the widget's last rendered state; run the cell again to draw it.
- **A cell's own output area ignores `clear_output`.**
- **Notebooks are not signed or trusted.** Zasper does not yet implement Jupyter's signature
  database, and stored `text/html` output can carry scripts that run when the notebook is opened,
  which is how Plotly and Bokeh outputs draw themselves. Treat a notebook you did not write the way
  you would treat any downloaded file.

## Keyboard shortcuts

Every action listed here is also in the command palette (`⇧⌘P` / `Ctrl+Shift+P`), which shows each
command's chord beside it, so the palette rather than this table is the thing to reach for when
you have forgotten one.

Where a row gives two chords for macOS, both work: `⌘` is the usual editor convention, and `⌃` is
what Zasper was bound to first.

### Global

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Show All Commands | `⇧⌘P` or `⌃⇧P` | `Ctrl+Shift+P` |
| Go to File | `⇧⌘O` or `⌃⇧O` | `Ctrl+Shift+O` |
| Zoom In | `⌘=` or `⌘+` | `Ctrl+=` or `Ctrl++` |
| Zoom Out | `⌘-` | `Ctrl+-` |
| Reset Zoom | `⌘0` | `Ctrl+0` |

Zoom scales the whole window, chrome included. To change only the size of code, terminal text and
cell output, use **Increase / Decrease Font Size** from the palette; those have no chord.

### Notebook

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Save Notebook | `⌘S` or `⌃S` | `Ctrl+S` |
| Run Cell | `⌃⏎` | `Ctrl+Enter` |
| Run Cell and Select Next | `⇧⏎` | `Shift+Enter` |
| Insert Cell Above | `⌃⇧A` | `Ctrl+Shift+A` |
| Insert Cell Below | `⌃⇧B` | `Ctrl+Shift+B` |
| Move Cell Up | `⌃⇧↑` | `Ctrl+Shift+Up` |
| Move Cell Down | `⌃⇧↓` | `Ctrl+Shift+Down` |
| Delete Cell | `⌃⇧D` | `Ctrl+Shift+D` |
| Undo Cell Operation | `⇧⌘Z` | `Ctrl+Shift+Z` |
| Change Cell to Code | `⌃⇧Y` | `Ctrl+Shift+Y` |
| Change Cell to Markdown | `⌃⇧M` | `Ctrl+Shift+M` |

Cell operations are on `⌃⇧` rather than a bare `⌃` on purpose: `⌃A`, `⌃B`, `⌃E` and `⌃K` are the
system text-editing bindings on macOS, and `Ctrl+A` is select-all everywhere else, so a bare chord
would be swallowed before the cell's editor saw it.

**Undo Cell Operation** is the notebook's own history: it takes back an inserted, deleted, cut,
pasted or retyped cell, and a cleared output. `⌘Z` inside a cell is the editor's, and still undoes
the text you typed there.

**Move Cell Up / Down** reorders the notebook and is not the same as **Select Next / Previous
Cell**, which only moves the selection. The cell's hover toolbar has both pairs: chevrons move the
selection, arrows move the cell. The focus travels with the cell, so the chord can be held to carry
one cell several places.

These have no chord and live in the palette: **Run All Cells**, **Cut / Copy / Paste Cell**,
**Select Next / Previous Cell**, **Change Cell to Raw**, **Expand or Collapse Output**,
**Clear Cell Output**, **Clear All Outputs**, **Interrupt Kernel**, **Restart Kernel**,
**Restart Kernel and Run All Cells**, **Reconnect to Kernel** and **Change Kernel**. The notebook
toolbar and a cell's hover toolbar reach most of them in one click.

### Inside a cell

These belong to the editor rather than to a command, because what they do depends on where the
cursor is.

| Key | What it does |
| --- | --- |
| `Tab` | Accepts the highlighted completion; with a word to the left of the cursor, asks the kernel for completions; otherwise indents |
| `↑` on the first line, `↓` on the last | Moves to the cell above or below |
| Double-click, or `Enter` on a selected markdown cell | Opens its source for editing |
| `Escape`, or running the cell, in a markdown cell | Renders it again |

A single click on a rendered markdown cell only selects it; it stays rendered.

## Configuration

### Command-line flags

| Flag | Default | Description |
| --- | --- | --- |
| `--cwd` | `.` | Base directory of the project |
| `--host` | `127.0.0.1` | Interface to bind; `0.0.0.0` puts the server on the network |
| `--port` | `:8048` | Port to start the server on |
| `--no-browser` | off | Do not open the app in a browser on startup |
| `--tracking` | `true` | Send anonymous usage data; see [Logging and privacy](#logging-and-privacy) |
| `--debug` | off | Set the log level to debug |
| `--version` | | Print the version and exit |

`--protected` is still accepted but ignored: Zasper always runs in protected mode.

### Environment variables

| Variable | Description |
| --- | --- |
| `ZASPER_ACCESS_TOKEN` | A fixed access token, instead of a new one on every start; open sessions survive a restart when it is set |
| `ZASPER_TELEMETRY` | `0` or `1` to turn anonymous usage data off or on for this run |
| `ZASPER_LOG_FORMAT` | `json` or `console`; by default, console on a terminal and JSON otherwise |
| `ZASPER_ACCESS_LOG` | `1` to log every request, not only the ones that failed |

## Logging and privacy

The server writes logs to standard output. Run it with `--debug` to raise the log level.

Zasper sends a small amount of anonymous usage data: counts of things like notebooks opened, cells
run and terminals started. It never sends file names, paths, code, project names, your username or
your IP address, and there is no session recording or autocapture.
[PRIVACY.md](PRIVACY.md) lists every event and every property, and explains how the allowlist that
enforces it works. To turn tracking off:

```sh
zasper --tracking=false     # this run
ZASPER_TELEMETRY=0 zasper   # this run, from the environment
```

Or clear **Settings → Privacy → Send anonymous usage data**, which is remembered. With tracking off
nothing is collected and no request is made.

## Architecture

![Zasper architecture](./assets/architecture.svg)

## Building from source

Requires Go 1.25+ and Node.js 22.12+ (`.nvmrc` pins the Node version, so `nvm use` picks it up).

```sh
git clone https://github.com/zasper-io/zasper
cd zasper
make init             # install the frontend's dependencies
make webapp-install   # build the frontend and install the zasper binary
```

`make webapp-install` puts `zasper` in your Go binary directory, so make sure that is on your
`PATH`, then check the install with `zasper --version`. `make build` builds the binary in the
repository instead, `make dev` runs the frontend and backend in development mode, and `make test`
runs both test suites. [CONTRIBUTING.md](CONTRIBUTING.md) covers the development workflow.

## Roadmap

- Rendering for the outputs listed as *not yet* under [What renders](#what-renders), first after
  1.0.
- Support for data apps, beyond Jupyter notebooks.
- Easier integration with existing tools.
- Zasper Hub, for self-hosted deployment in the cloud.

## Documentation

- [zasper.io/docs](https://zasper.io/docs): the user documentation.
- [CHANGELOG.md](CHANGELOG.md): what changed in each release.
- [docs/API.md](docs/API.md): the HTTP and WebSocket API, covered by semantic versioning from
  1.0.0 onwards.
- [PRIVACY.md](PRIVACY.md): what anonymous usage data is collected, event by event.
- [PUBLISHING.md](PUBLISHING.md): how releases are cut.

## Community and support

- **Questions and discussion:** join the Zasper community on
  [Slack](https://join.slack.com/t/zasper/shared_invite/zt-30sx3uo8w-w~sw4Kje1aoUjxY5MZ_Fkg).
- **Bugs and feature requests:** open an [issue](https://github.com/zasper-io/zasper/issues).
- **Sponsorship:** support Zasper's development through
  [GitHub Sponsors](https://github.com/sponsors/prasunanand).

### Acknowledgements

Zasper's development has been supported by a grant from FOSS United and Zerodha.

<p>
  <img height="80" src="./assets/foss-united.png" alt="FOSS United">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img height="64" src="./assets/zerodha.png" alt="Zerodha">
</p>

Zasper would not exist without the Jupyter community. It uses the Jupyter wire protocol and draws
on Jupyter's architecture, and our thanks go to everyone who has built that foundation.

## Contributing

Contributions of every kind are welcome: bug reports, documentation, and pull requests or reviews
of them. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to build Zasper and submit changes.
Before your first pull request is merged, you will be asked to sign the
[Contributor License Agreement](CLA.md). Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

<a href="https://github.com/zasper-io/zasper/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=zasper-io/zasper" alt="Contributors">
</a>

## License

Copyright © 2024–2026 Prasun Anand.

Zasper is dual-licensed. You can use it under either of these:

- **Open source:** the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`).
  See [LICENSE](LICENSE). Running Zasper, on your own machine or on a server, needs nothing
  more. If you distribute Zasper, or let people use a modified version over a network, the AGPL
  requires you to make the corresponding source, including your changes, available under the
  same license.
- **Commercial:** for organizations that want to build Zasper into a proprietary product,
  keep their modifications private, or need terms the AGPL does not offer. Write to
  [prasun@zasper.io](mailto:prasun@zasper.io).

Contributions are accepted under the [Contributor License Agreement](CLA.md), which is what
lets Zasper be offered under both licenses.
