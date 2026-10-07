# Trusted folders

Opening a folder someone else wrote should not run their code until you say so. Zasper asks once per
folder whether you trust the authors of its files. Until you do, the folder is **restricted**: you can
read every file, notebook and saved output in it, and nothing the folder controls runs.

This page is what trust covers, how it is decided, and how it is enforced, for anyone running Zasper on
a server and anyone changing what runs when a folder opens.

## What runs in a folder

Before trust, opening a folder could run its code without anyone pressing Run:

- **A notebook's kernel** started as the notebook opened. The kernel is the one the notebook names, and
  that can be the folder's own `.venv/bin/python`: any program the folder ships, with its `.pth` files
  and `sitecustomize`.
- **Language servers** started as a file opened. Their program could come from the folder's `.venv` or
  `node_modules`, Python's were handed the folder's `.venv` interpreter and ran it, and some run project
  code as part of their job: gopls runs `go list` and can download the toolchain a `go.mod` names,
  rust-analyzer runs build scripts, R sources `.Rprofile`.
- **Git** runs what a repository's own `.git/config` names: hooks on commit, checkout, pull and push,
  clean and smudge filters on stage and checkout, credential helpers and `core.sshCommand` on fetch and
  push, a signing program on commit, `core.fsmonitor` on anything that reads the index. A folder
  handed over with its `.git` can carry any of them, and git has no switch that ignores that file.

## Restricted and trusted

|                                                                        | Restricted                                                                                          | Trusted                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------ |
| Files, notebooks, saved outputs, search, diffs, git status             | ✓                                                                                                   | ✓                              |
| A notebook's kernel                                                    | not started; Run asks                                                                               | starts when the notebook opens |
| The folder's own `.venv`                                               | not listed as a kernel or used to run a file                                                        | ✓                              |
| Run Python File, Set up a Python kernel                                | refused; asks                                                                                       | ✓                              |
| Language servers                                                       | only basedpyright, pyright and clangd, which read code without running it, found outside the folder | every server                   |
| Git stage, commit, discard, checkout, branch delete, fetch, pull, push | refused; asks                                                                                       | as git runs them               |
| Terminals                                                              | ✓ — what is typed into one is asked for                                                             | ✓                              |

A kernel already running keeps running when its folder is restricted, because stopping it would lose
what it holds; nothing new starts. A notebook whose kernel is running rejoins it.

## Being asked

The question comes the first time a window opens an untrusted folder, before anything in it has run:
_Do you trust the authors of the files in this folder?_ It names the folder, and offers _Trust
everything in_ the folder that holds it, for someone who clones repositories into one place they trust.
_Stay restricted_, Escape and the close button never trust, and the question is not asked again in that
browser tab.

Restricted mode then says so in three places, each of which asks again: a shield and _Restricted_ as the
status bar's first item, a band over every notebook, and the notebook's kernel pill. Run, Run all and a
language server's _Trust folder…_ ask the question for what was pressed; _Trust and run_ trusts the
folder, starts the kernel and runs the cell in one press.

Every folder is asked about, including the one `zasper` was started in and every folder after an
upgrade from 2.0. Typing `zasper` in a folder says you meant to open it, not that you trust it.

## Where trust is kept

In `~/.zasper/config.json`, on the server, because the server is what starts processes:

```json
{
  "trusted_folders": [
    { "path": "/home/me/src", "since": "2026-10-07T09:00:00Z" }
  ],
  "trust_all": false
}
```

Trusting a folder trusts everything under it. Paths are compared with symlinks resolved, so `/tmp/x` and
`/private/tmp/x` are one folder. **Settings → Trust** lists the folders trusted, each with _Remove_,
which restricts it at once.

Three ways skip the question:

|                                                             | Scope                      | Written down                                 |
| ----------------------------------------------------------- | -------------------------- | -------------------------------------------- |
| `zasper --trust`                                            | the folder this run serves | no                                           |
| `trust_all` in config, or **Settings → Trust every folder** | every folder               | yes                                          |
| `ZASPER_TRUST_ALL=1` in the environment                     | every folder               | no; Settings shows it and cannot turn it off |

The Docker image sets `ZASPER_TRUST_ALL=1`: the folder a container serves is its user's own. A shared
server that opens only its owner's files is what `trust_all` is for.

## Enforced on the server

The UI asks; the server refuses. In a restricted folder these answer `403` with
`{"error": "untrusted"}`, which the UI turns into the question:

- `POST /api/sessions`, when it would start a kernel rather than rejoin one;
- `GET /api/terminals/run-command`;
- `POST /api/environment/setup`;
- every git route that changes the repository: `stage`, `unstage`, `discard`, `commit`, `checkout`,
  `DELETE /api/git/branches`, `fetch`, `pull` and `push`. Reads — status, diffs, history, branches — stay
  open, and run with `core.fsmonitor` and hooks off. `init` stays open: a repository that does not exist
  yet has no config to run.

`/ws/lsp/{language}` closes with code `4004` for a server that runs project code, and `/api/lsp/servers`
marks it `restricted`. `/api/kernelspecs` leaves out the folder's own `.venv`, `/api/interpreters`
answers no automatic interpreter, and `/api/trust` reports the `.venv` as `environment` so the launcher
can show it locked. The API is in [API.md](API.md).

## Two fixes that do not depend on trust

Both broke a trusted folder too, whenever it had a file named like a standard module in it:

- **A kernel starts with its folder off `sys.path`.** `python -m ipykernel_launcher` put the notebook's
  folder first on `sys.path`, so a `pathlib.py` beside the notebook was imported, and so run, as the
  kernel started, which then failed. An ipykernel is now started as `python -c` with a few lines that
  take the folder off `sys.path` and then run `ipykernel_launcher` as `-m` would, which works on every
  Python 3 (`-P` would, but only from 3.11). IPython puts the folder back once it is up, so a cell still
  imports a module beside the notebook.
- **Interpreters are asked in a neutral folder.** Listing kernels asks each Python on the machine where
  its packages are, with `python -c`, which also puts the working directory on `sys.path`: a `json.py`
  in the folder `zasper` was started in ran. The probe now runs in the system's temp directory.

## Where the work is done

| Piece                                  | Where                                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| The gate, the config and `/api/trust`  | `internal/trust/`, `internal/config/config.go`                                                                                          |
| Kernels                                | `Kernels.RequireTrust` in `internal/kernel/kernels.go`; the `403` in `internal/session/session_api_handler.go`                          |
| The `.venv`, Run Python File, setup    | `Catalog.RequireTrust` in `internal/kernelspec/catalog.go`; `internal/terminal/run_command.go`                                          |
| Language servers                       | `ReadsOnly` and the restricted finder in `internal/lsp/catalog.go`                                                                      |
| Git                                    | `s.trust.Require` on the write routes in `internal/server/router.go`; `restrictedArgs` in `internal/gitclient/git_cli.go` for the reads |
| Wiring, `--trust`, `ZASPER_TRUST_ALL`  | `internal/server/server.go`, `main_cli.go`, `docker/Dockerfile`                                                                         |
| The question and the status bar        | `ui/src/ide/trust/`                                                                                                                     |
| A notebook's held-back kernel and runs | `useKernelSession.ts` and `NotebookEditor.tsx` in `ui/src/ide/editor/notebook/`                                                         |

## Not covered

- **A trusted folder's kernel trusts everything it is sent.** A live kernel's HTML outputs run their
  scripts, and widget code it names is loaded from jsdelivr; trust is the gate in front of both.
