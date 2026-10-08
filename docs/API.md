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
  its own. To reach the server by another name, such as a reverse proxy's, name
  it with `--allow-host` or `ZASPER_ALLOWED_HOSTS`.
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

## Trust

Whether the project's own code may run: its kernels, its `.venv` and language servers that build it.
See [TRUST.md](TRUST.md).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/trust` | `folder` (the project, absolute), `trusted`, `by` (`folder`, `parent`, `all`, `flag`, `env`, or `""` while restricted), `through` (the trusted folder that covers it), `trust_all`, `env` (`ZASPER_TRUST_ALL` is set), `folders` (each `path` and `since`), and `environment`, the project's own Python while it is restricted. |
| `POST` | `/api/trust` | `{"path"}`: trust the project or a folder it is in. Answers the state that follows; `400` for any other folder. |
| `DELETE` | `/api/trust` | `{"path"}`: stop trusting a folder in the list. |
| `PUT` | `/api/trust/all` | `{"trust_all": true}` trusts every folder; `false` stops. |

## Sessions and kernels

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/sessions` | List sessions. |
| `POST` | `/api/sessions` | Create a session, starting a kernel. `403` with `{"error": "untrusted"}` when it would start one in a folder that is not trusted; rejoining a running kernel is not refused. |
| `DELETE` | `/api/sessions/{sessionId}` | End a session and stop its kernel. |
| `GET` | `/api/kernels` | List running kernels. |
| `GET` | `/api/kernels/resources` | What every running kernel holds, read at most once a second. `kernels` by id: `memory` (bytes, the footprint of the kernel and every process it started), `processes`, and `gpus` (`index`, `memory`) it holds memory on. `memory`: the machine's or its container's `used`, `total` and `limit` (`machine` or `container`), `null` on Windows. `gpus`: each NVIDIA device's `index`, `name`, `utilization` (percent, or `null`), `memory_used`, `memory_total`, and `unattributed`, memory held by processes the server cannot see. See [KERNEL-RESOURCES.md](KERNEL-RESOURCES.md). |
| `GET` | `/api/kernels/{kernelId}` | Read one kernel. |
| `POST` | `/api/kernels/{kernelId}/interrupt` | Interrupt. |
| `POST` | `/api/kernels/{kernelId}/install` | `{"package"}`: install a package, extras allowed (`psycopg[binary]`), into the interpreter a Python kernel runs, with pip, or uv where there is no pip. Answers `ok` and pip's `log`. `400` for anything but a package name, `403` (`untrusted`) in a folder that is not trusted. |
| `GET` | `/api/kernels/{kernelId}/variables` | The names in a Python kernel's namespace: type, kind, shape or length, a short summary, and whether it can be shown as a table. `422` for a kernel that is not Python, `504` if a running cell kept the kernel busy for 10 seconds. |
| `POST` | `/api/kernels/{kernelId}/variables/{name}/rows` | A page of a DataFrame, Series or 1–2-D array, filtered and sorted in the kernel. Body: `offset`, `limit` (1–1000), optional `sort` (`column`, `descending`) and up to 20 `filters` (`column`, `op`, `value`); columns are named by position. The CSV route also takes `columns`, the positions to export in order. `op` is one of `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `contains`, `not_contains`, `starts_with`, `missing`, `present`. Answers the columns with dtype and kind, the index, the rows, `total_rows` and `matched_rows`; a missing value is `{"missing": "NaN"}` with the text pandas prints. `400` for a malformed query or a name that is not an identifier, `422` for a value a column cannot be compared with, or a variable that is not defined or not a table. |

`{name}` in the three routes above is a variable's name, or `@` and the `id` of a cell's DataFrame
output. In a Python kernel such an output carries `application/vnd.zasper.dataframe+json` —
`{"id", "kind", "rows", "columns"}` — beside pandas' own `text/html`, and the kernel keeps the last 50
frames it displayed under those ids. One it has let go, or one from a kernel since restarted, answers
`410`, and the output is shown as the HTML pandas wrote. See [DATAFRAMES.md](DATAFRAMES.md).
| `POST` | `/api/kernels/{kernelId}/variables/{name}/csv` | The rows the body's `sort` and `filters` leave, as `text/csv`, the first 100,000 of them. |
| `GET` | `/api/kernels/{kernelId}/variables/{name}/profile` | Per column: kind, count, missing, distinct, and either min, max, mean, standard deviation and a histogram, or the five commonest values. |
| `POST` | `/api/kernels/{kernelId}/variables/{name}/chart` | What a chart of the rows the body's `filters` leave draws, counted in the kernel. Body: `kind` (`histogram`, `bar`, `line`, `scatter`, `box`), columns by position in `x`, `y` (a list, up to three for a line) and `color`, and `agg` (`count`, `sum`, `mean`, `median`, `min`, `max`). A histogram answers `counts` and `edges` (50 bins at most); a bar, `categories` (the 20 largest, `other_categories` folded into one more) and `series` of `values`; a line, `series` of `x` and `y` (2,000 points a line at most, each stretch's lowest and highest); a scatter, `series` of `x` and `y` and `sampled` (5,000 rows at most, the same each time); a box, `series` of quartiles, whiskers, mean, count and up to 50 outliers. Coloured by a column, the eight commonest values of the whole frame are a series each (three for a scatter) and the rest one with `other: true`. Every answer carries `matched_rows` and `total_rows`. `422` for a column of the wrong kind. |
| `POST` | `/api/kernels/{kernelId}/stop` | Stop. |
| `DELETE` | `/api/kernels/{kernelId}` | Stop. Equivalent to `/stop`. |
| `GET` | `/api/kernelspecs` | Installed kernelspecs. |
| `GET` | `/api/kernelspecs/{kernelName}` | One kernelspec. `404` if it is not installed. |
| `GET` | `/kernelspecs/{kernel}/{resource}` | A kernelspec resource, such as its logo. |
| `GET` | `/static/kernelspecs/{kernel}/{resource}` | The same resource at Zasper's older address. |
| `GET` | `/api/environment/setup` | State of the project `.venv` setup: `idle`, `running`, `succeeded` or `failed`, with its log. |
| `POST` | `/api/environment/setup` | Start setting up a `.venv` with `ipykernel` in the project. `202`, or `409` if one is already running. `403` (`untrusted`) in a folder that is not trusted. |
| `GET` | `/api/interpreters` | The Python interpreters found, the one chosen in Settings, and the one the project would use automatically. |
| `GET` | `/ws/kernels/{kernelId}/channels` | **WebSocket.** Jupyter wire protocol. |

`/ws/kernels/{kernelId}/channels` takes `?session_id=<id>` and speaks Jupyter's
message protocol version 5.3. Messages are signed and signatures are verified on
receipt.

The first message on every such socket is Zasper's own, sent before any kernel
message: `channel` is `zasper`, `header.msg_type` is `zasper_replay`, and
`content.runs` lists the cell runs this client missed — those still going, and those
that finished with no client attached. Each run carries `msg_id` (the request's),
`cell_id`, `code`, `execution_count`, `outputs` (nbformat outputs), `clear_waiting`
and `done`. A client that does not know the message can ignore it. See
[RUNS.md](RUNS.md).

## Data connections

The databases SQL cells run on. Passwords are never answered. See [SQL.md](SQL.md).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/connections` | `connections`, each `name`, `type`, `host`, `port`, `database`, `user`, `path` or `url`, `scope` (`project` or `user`) and `has_password`; and `types`, the types a connection can have. |
| `PUT` | `/api/connections` | Add or change one: a connection, plus `previous` (the name it had, for a rename) and `password` (absent keeps the stored one, `""` removes it). Answers the list. `400` for a name already taken or a connection that lacks what its type needs. |
| `DELETE` | `/api/connections` | `{"scope", "name"}`: remove one and its password. Answers the list. |
| `POST` | `/api/connections/prepare` | `{"kernel", "name"}`: hand a notebook's kernel the connection a SQL cell is about to run on. |
| `POST` | `/api/connections/schema` | `{"name", "kernel"?}`: `schemas`, each `name`, `default` and `tables` (`name`, `kind` of `table`, `view` or `dataframe`, and `rows` for a dataframe), or `error`. Asks the Data panel's own kernel unless `kernel` names one; `dataframes` is the frames of the kernel named. |
| `POST` | `/api/connections/columns` | `{"name", "schema", "table", "kernel"?}`: `columns`, each `name` and `type`, or `error`. |
| `POST` | `/api/connections/count` | `{"kernel", "name", "query"}`: how many rows a SQL cell's query answers, counted in the notebook's kernel before Load all. `rows`, or `rows: null` and `error`, which is also the answer after 10 seconds, when the kernel cancels the count. |
| `POST` | `/api/connections/test` | `{"connection", "password"?, "kernel"?}`: connect with a connection as a form holds it, saved or not. `ok`, `version`, `ms`, or `error` and `missing`, the package to install. |

`prepare`, `schema`, `columns`, `count` and `test` run code in a kernel: `403` (`untrusted`) in a folder that is not
trusted, `409` when the kernel named is not running or no Python kernel is installed. `error` with
`missing` set means the kernel lacks that driver.

## Terminals

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/terminals` | List running terminals. |
| `GET` | `/api/terminals/run-command` | `?path=`. The shell line that runs a project `.py` file, and the interpreter it uses: `{"command", "interpreter"}`. `400` for anything but a `.py` file, `403` (`untrusted`) in a folder that is not trusted. |
| `DELETE` | `/api/terminals/{terminalId}` | Kill one. |
| `GET` | `/ws/terminals/{terminalId}` | **WebSocket.** Bytes to and from the shell. |

Terminals are not available on Windows yet; the WebSocket says so and closes.

## Git

All routes act on the project directory's repository.

In a folder that is not trusted, every route below that changes the repository — stage, unstage,
discard, commit, checkout, branch delete, fetch, pull, push — answers `403` with `{"error": "untrusted"}`:
a repository's own config can make git run commands. See [TRUST.md](TRUST.md).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/git/status` | Working tree and index status. |
| `GET` | `/api/git/log` | History. |
| `GET` | `/api/git/commit/{hash}` | One commit's detail. |
| `GET` | `/api/git/diff` | Both sides of a path's comparison, whole. For a notebook, also each side's cells under `notebook` (`original`, `modified`; an absent side is `null`). See [NOTEBOOK-DIFFS.md](NOTEBOOK-DIFFS.md). |
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
