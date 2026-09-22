# Zasper HTTP and WebSocket API

This is the interface Zasper's frontend speaks to its server, and it is a public
interface: from 1.0.0 it is covered by semantic versioning. Routes and payload
shapes described here will not change incompatibly within a major version.
Anything not described here is internal and may change at any time. What 2.0.0
broke, and why, is under [Removed in 2.0.0](#removed-in-200).

The server listens on `127.0.0.1:8048` by default. See
[README](../README.md#self-hosting) for binding it elsewhere.

## A note on shape

Zasper's API does **not** mirror Jupyter Server's. The most visible differences:
a file is read with `POST /api/contents` carrying the path in the body rather
than `GET /api/contents/<path>`, and `DELETE /api/contents` likewise takes its
path in the body. These are frozen for 2.x. More conventional path-based
equivalents may be added alongside them in a later 2.x release; if they are, the
originals keep working.

## Authentication

Every route except `/api/health`, `/api/config` and `/auth/login` requires
credentials. The server prints a **server access token** at startup — random per
process unless `ZASPER_ACCESS_TOKEN` sets it. Exchange it for a session:

```http
POST /auth/login
Content-Type: application/json

{ "accessToken": "<the token from the banner>" }
```

```json
{ "token": "<jwt>", "redirect_path": "/" }
```

The answer also sets the session as an `HttpOnly`, `SameSite=Strict` cookie,
`zasper_session`, which is how a browser is signed in. A client that is not a
browser sends the `token` as `Authorization: Bearer <jwt>` on every other
request, WebSocket upgrades included. The server never reads a session from a
URL.

A request authenticated by the cookie that changes something (any method but
`GET`, `HEAD` and `OPTIONS`) must come from Zasper's own origin, or it is
refused with `403`. A bearer token is not checked this way.

`POST /auth/logout` ends the session on the server, so a copy of the token stops
working too, and clears the cookie. It answers `204`.

The link the server opens in a browser, `/?token=<access token>`, is for the
frontend: it makes the same exchange and removes the token from the address bar.

Sessions last 24 hours. They are signed with a key derived from the server access
token, so restarting the server invalidates them — unless `ZASPER_ACCESS_TOKEN`
pins that token, in which case sessions survive the restart.

## Conventions

- Request and response bodies are JSON unless noted.
- A path in a body is relative to the project directory. Paths that escape it are
  refused; `..` is rejected rather than resolved.
- Errors carry a non-2xx status and a plain-text or `{"message": "..."}` body.
- A server bound to a loopback address answers only requests whose `Host` is
  `localhost`, a name under `.localhost` or a loopback IP, and refuses any other
  with `403`. This stops a DNS-rebinding page from reaching it under a name of
  its own. To reach the server by another name, start it with `--host`.
- Request bodies are capped: 16 KiB under `/auth`, and 512 MiB under `/api`
  except `POST /api/contents/upload`, which is not capped.

## Server

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Readiness probe. Unauthenticated. |
| `GET` | `/api/config` | Version. Unauthenticated. |
| `GET` | `/api/info` | Project name and directory, user, OS, architecture, version, theme. |
| `POST` | `/api/config/modify` | Update a stored setting. |

## Contents

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/contents` | **Read** a file or list a directory. Body: `{"path": "..."}`. |
| `PUT` | `/api/contents` | Write a file. |
| `POST` | `/api/contents/create` | Create a file or directory. |
| `DELETE` | `/api/contents` | Delete. Body carries the path. |
| `POST` | `/api/contents/rename` | Rename in place. |
| `POST` | `/api/contents/move` | Move to another directory. |
| `POST` | `/api/contents/copy` | Copy. |
| `GET` | `/api/contents/download` | Download a file's bytes. |
| `POST` | `/api/contents/upload` | Upload; body is the file. |
| `GET` | `/api/contents/editorconfig` | `?path=`. The `.editorconfig` properties that apply to a file, read up to a `root = true`. A file that cannot be parsed gives an empty answer. |
| `POST` | `/api/contents/edits` | Apply a language server's edits to files no editor holds. Each file answers for itself: what was applied, or why not. |
| `GET` | `/api/contents/watch` | **WebSocket.** See below. |

Writes are atomic: Zasper writes beside the target and renames over it, so an
interrupted save cannot truncate a notebook.

### `GET /api/contents/watch` (WebSocket)

Sends the literal string `reload` whenever anything in the project changes. It
carries no detail about what changed — re-read what you need. This protocol is
deliberately minimal and may gain structure in a later 2.x release; a client
should treat any message as "something changed".

## Sessions and kernels

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/sessions` | List sessions. |
| `POST` | `/api/sessions` | Create a session, starting a kernel. |
| `DELETE` | `/api/sessions/{sessionId}` | End a session and stop its kernel. |
| `GET` | `/api/kernels` | List running kernels. |
| `GET` | `/api/kernels/{kernelId}` | Read one kernel. |
| `POST` | `/api/kernels/{kernelId}/interrupt` | Interrupt. |
| `POST` | `/api/kernels/{kernelId}/stop` | Stop. |
| `DELETE` | `/api/kernels/{kernelId}` | Stop. Equivalent to `/stop`. |
| `GET` | `/api/kernelspecs` | Installed kernelspecs. |
| `GET` | `/api/kernelspecs/{kernelName}` | One kernelspec. `404` if it is not installed. |
| `GET` | `/kernelspecs/{kernel}/{resource}` | A kernelspec resource, such as its logo. |
| `GET` | `/static/kernelspecs/{kernel}/{resource}` | The same resource at Zasper's older address. |
| `GET` | `/api/environment/setup` | State of the project `.venv` setup: `idle`, `running`, `succeeded` or `failed`, with its log. |
| `POST` | `/api/environment/setup` | Start setting up a `.venv` with `ipykernel` in the project. `202`, or `409` if one is already running. |
| `GET` | `/api/interpreters` | The Python interpreters found, the one chosen in Settings, and the one the project would use automatically. |
| `GET` | `/ws/kernels/{kernelId}/channels` | **WebSocket.** Jupyter wire protocol. |

`/ws/kernels/{kernelId}/channels` takes `?session_id=<id>` and speaks Jupyter's
message protocol version 5.3. Messages are signed and signatures are verified on
receipt.

## Terminals

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/terminals` | List running terminals. |
| `GET` | `/api/terminals/run-command` | `?path=`. The shell line that runs a project `.py` file, and the interpreter it uses: `{"command", "interpreter"}`. `400` for anything but a `.py` file. |
| `DELETE` | `/api/terminals/{terminalId}` | Kill one. |
| `GET` | `/ws/terminals/{terminalId}` | **WebSocket.** Bytes to and from the shell. |

Terminals are not available on Windows yet; the WebSocket says so and closes.

## Git

All routes act on the project directory's repository.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/git/status` | Working tree and index status. |
| `GET` | `/api/git/log` | History. |
| `GET` | `/api/git/commit/{hash}` | One commit's detail. |
| `GET` | `/api/git/diff` | Diff for a path. |
| `POST` | `/api/git/stage` · `/unstage` · `/discard` | Index and working tree. |
| `POST` | `/api/git/commit` | Commit what is staged. |
| `GET` | `/api/git/branches` | List branches. |
| `DELETE` | `/api/git/branches` | Delete a branch. |
| `POST` | `/api/git/checkout` | Switch branch. |
| `POST` | `/api/git/fetch` · `/pull` · `/push` | Remote sync. |
| `POST` | `/api/git/init` | Initialise a repository. |
| `GET` | `/api/current-branch` | The current branch name alone, for the status bar. |

## Search

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/files` | Filename suggestions for the command palette. |
| `POST` | `/api/search` | Search file contents. The answer is newline-delimited JSON: one object per file as it is found, then a summary. Closing the request cancels the search. |
| `POST` | `/api/search/buffer` | Search text the client sends for one file, such as an editor's unsaved contents, with the same engine. |
| `POST` | `/api/search/preview` | A text file as it is on disk and as a replace would leave it: `{"original", "replaced"}`. |
| `POST` | `/api/search/replace` | Write a replacement into files. A file that fails is listed in `failed` and the rest are still written. |

## Language servers

Zasper starts language servers installed on the machine; see
[LANGUAGE-SERVERS.md](LANGUAGE-SERVERS.md).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/lsp/servers` | For each language, which server would be started and whether it is installed. |
| `GET` | `/api/lsp/log` | `?language=`. What that language's servers wrote to standard error, as plain text. |
| `GET` | `/ws/lsp/{language}` | **WebSocket.** Starts the language's server and carries its LSP messages both ways. Closing the socket stops the server. |

## Telemetry

See [PRIVACY.md](../PRIVACY.md) for what is collected and why.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/telemetry` | Report frontend events. The server validates each against its own allowlist and rejects anything else; naming an event here does not make it sendable. |
| `GET` | `/api/telemetry/settings` | Whether anything is being sent, and whether this install has been asked. |
| `POST` | `/api/telemetry/settings` | Turn it off, or reset the anonymous id. |

## Removed in 2.0.0

These two changes are why 2.0.0 is a major release. Both came out of moving the
browser's session out of JavaScript and into an `HttpOnly` cookie.

- **`?token=<jwt>` on WebSocket routes.** A session token in a URL is exposed
  wherever URLs are recorded: server and reverse-proxy access logs, browser
  history, and crash and error reports. Anyone who reads one of those holds a
  live session for up to 24 hours. The query token existed only because a browser
  cannot put a header on a WebSocket. Now that the browser sends the cookie on
  the upgrade, nothing needs it, so the server no longer reads a session from a
  URL at all. A script sends `Authorization: Bearer <jwt>` on the upgrade instead,
  which WebSocket client libraries support.
- **`protected` in `/api/config` and `/api/info`.** Since 1.1.0 every server
  requires the access token, so the field was `true` on every server and told a
  client nothing. Treat a missing field as `true`.

## Removed in 1.0.0

- `DELETE /ws/kernels/{kernel_id}` — duplicated `DELETE /api/kernels/{kernelId}`,
  which is unchanged. It also sat on the WebSocket subrouter, so it took its
  token from the URL rather than a header.
