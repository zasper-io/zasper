# Zasper HTTP and WebSocket API

This is the interface Zasper's frontend speaks to its server, and it is a public
interface: from 1.0.0 it is covered by semantic versioning. Routes and payload
shapes described here will not change incompatibly within 1.x. Anything not
described here is internal and may change at any time.

The server listens on `127.0.0.1:8048` by default. See
[README](../README.md#-hosting-zasper) for binding it elsewhere.

## A note on shape

Zasper's API does **not** mirror Jupyter Server's. The most visible differences:
a file is read with `POST /api/contents` carrying the path in the body rather
than `GET /api/contents/<path>`, and `DELETE /api/contents` likewise takes its
path in the body. These are frozen for 1.x. More conventional path-based
equivalents may be added alongside them in a later 1.x release; if they are, the
originals keep working.

## Authentication

Every route except `/api/health`, `/api/config` and `/auth/login` requires
credentials. The server prints a **server access token** at startup — random per
process unless `ZASPER_TOKEN` sets it. Exchange it for a JWT:

```http
POST /auth/login
Content-Type: application/json

{ "accessToken": "<the token from the banner>" }
```

```json
{ "token": "<jwt>", "redirect_path": "/" }
```

Send the JWT as `Authorization: Bearer <jwt>` on every `/api` and `/static`
route. WebSocket routes cannot carry headers, so they take `?token=<jwt>` in the
query string instead; this is the only place the server reads a token from a URL.

The link the server opens in a browser, `/?token=<access token>`, is for the
frontend: it makes the same exchange and removes the token from the address bar.

Tokens last 24 hours. The signing secret is random per process unless
`ZASPER_JWT_SECRET` is set, so restarting the server invalidates issued tokens.

## Conventions

- Request and response bodies are JSON unless noted.
- A path in a body is relative to the project directory. Paths that escape it are
  refused; `..` is rejected rather than resolved.
- Errors carry a non-2xx status and a plain-text or `{"message": "..."}` body.

## Server

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Readiness probe. Unauthenticated even in protected mode. |
| `GET` | `/api/config` | Version and whether protected mode is on. Unauthenticated. |
| `GET` | `/api/info` | Project name, user, OS, version, theme, protected flag. |
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
| `GET` | `/api/contents/watch` | **WebSocket.** See below. |

Writes are atomic: Zasper writes beside the target and renames over it, so an
interrupted save cannot truncate a notebook.

### `GET /api/contents/watch` (WebSocket)

Sends the literal string `reload` whenever anything in the project changes. It
carries no detail about what changed — re-read what you need. This protocol is
deliberately minimal and may gain structure in a later 1.x release; a client
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
| `GET` | `/api/kernelspecs/{kernelName}` | One kernelspec. |
| `GET` | `/static/kernelspecs/{kernel}/{resource}` | A kernelspec resource, such as its logo. |
| `GET` | `/ws/kernels/{kernelId}/channels` | **WebSocket.** Jupyter wire protocol. |

`/ws/kernels/{kernelId}/channels` takes `?session_id=<id>` and speaks Jupyter's
message protocol version 5.3. Messages are signed and signatures are verified on
receipt.

## Terminals

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/terminals` | List running terminals. |
| `DELETE` | `/api/terminals/{terminalId}` | Kill one. |
| `GET` | `/ws/terminals/{terminalId}` | **WebSocket.** Bytes to and from the shell. |

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

## Telemetry

See [PRIVACY.md](../PRIVACY.md) for what is collected and why.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/telemetry` | Report frontend events. The server validates each against its own allowlist and rejects anything else; naming an event here does not make it sendable. |
| `GET` | `/api/telemetry/settings` | Whether anything is being sent, and whether this install has been asked. |
| `POST` | `/api/telemetry/settings` | Turn it off, or reset the anonymous id. |

## Removed in 1.0.0

- `DELETE /ws/kernels/{kernel_id}` — duplicated `DELETE /api/kernels/{kernelId}`,
  which is unchanged. It also sat on the WebSocket subrouter, so it took its
  token from the URL rather than a header.
