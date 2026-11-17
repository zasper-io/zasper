# Hosting agents

Zasper can run a coding agent the user already has — Claude Code, Codex, Antigravity CLI — inside the project,
and hold the conversation with it, over the [Agent Client Protocol](https://agentclientprotocol.com).
The agent is the user's own, signed in with their own account; Zasper stores nothing of it and sends
nothing anywhere. For an agent that runs on its own and only uses Zasper's tools, see [MCP.md](MCP.md).

## The panel

The bot in the topbar opens the agent panel on the right of the editor, beside the file tree. With no
chat it lists the agents Zasper knows: those installed with a Start button, the others with the
command that installs them and Check again; any other ACP agent starts by its command line. While an agent starts the panel shows how long it
has taken, and Cancel gives up on it: the request ends and the server stops the agent's process. The
conversation streams in as the agent works: its messages, its thinking folded away, a row per tool call
that opens the file it touched, its plan, and each question it asks with its options as buttons. Enter
sends, and the button becomes Stop while the agent works. A reload or a second tab shows the same chat.

`@` in the composer finds a file by name, including one `.gitignore` leaves out (a dataset often is),
shown dimmed after the rest; the message mentions it: the agent is sent a link to it
(ACP's `resource_link`) and reads it itself. In a notebook, a cell's menu has **Add Cell to Chat** and
**Add Output to Chat**, which are also commands in the palette: the cell's source, or its output as
text, goes with the next message as it is on screen, unsaved edits and all — embedded (`resource`, with
a `file://…#cell=<id>` URI) for an agent that takes embedded context, as part of the message otherwise.
What a message mentions shows as chips above the field, and in the message once sent.

The clock in the panel's title lists the agent's past conversations in the project, newest first, when
the agent can list and open them (Claude Code can, including those held with `claude` in a terminal
here). Picking one goes on in it: the agent replays it into the panel. What Zasper added to a
conversation and the agent did not keep — its questions and their answers, a command's live output —
does not come back. Zasper keeps no history of its own.

## A turn's changes

When a turn ends, the files it changed are listed under it, each opening a diff of the file before the
turn against the file on disk now. **Undo this turn** puts them back as they were before it: a file it
added is removed, one it deleted comes back; each file's own undo puts back that file alone. In the
diff, each changed block of a text file, and each changed cell of a notebook, has its own undo, which
writes the file straight away, checked against the version shown. A file that has changed since the
turn is named first, and put back only when the reader says to. Open tabs take the files back as they
take any change on disk.

The changes are found by snapshotting the project at the start and end of each turn, so every change
counts, however it was made: the agent's own edits, a command it ran, a notebook tool — and an edit the
reader made in the meantime. The snapshots are git trees in a repository of Zasper's own under
`~/.zasper/checkpoints/`, with the project as its work tree; the project's own repository is never
touched. git runs there with no global or system configuration and no hooks, so it stores the bytes on
disk. What `.gitignore` leaves out, `node_modules`, `.venv` and the other folders every walk skips,
`.zasper/`, and files over 20 MB are not kept. Without git, turns are not recorded. The first snapshot
of a project reads every file, and is taken when the chat starts.

A chat's snapshots are kept while it runs: each turn's two are pinned by a ref under the server's pid.
When the chat ends, or opens a past conversation, they are let go and git prunes what nothing pins. A
server that crashed leaves its pins behind; the next server to snapshot the project drops the pins of
servers no longer running. A project not snapshotted for 30 days has its store removed whole. Deleting
`~/.zasper/checkpoints/` by hand is safe: it loses the review and undo of the turns already taken.

## Agents

| Agent | Started as | When it is not found |
|---|---|---|
| Claude Code | `claude-agent-acp`, or `npx -y @agentclientprotocol/claude-agent-acp` when `npx` and `claude` are installed | `npm install -g @agentclientprotocol/claude-agent-acp`, and sign in once by running `claude` |
| Codex | `codex-acp` | `npm install -g @agentclientprotocol/codex-acp` beside the `codex` CLI, and sign in once by running `codex` |
| Antigravity CLI | `agy acp` | Google's install script (`curl -fsSL https://antigravity.google/cli/install.sh \| bash`, or `install.ps1` on Windows), and sign in once by running `agy` |
| Any other | the command line given | |

Gemini CLI is not listed: since 18 June 2026 it no longer serves personal Google accounts, and
Antigravity CLI signs in with those, a Gemini API key or a business account alike. It still starts as
any other agent, by its command line (`gemini --experimental-acp`).

Claude Code and Antigravity CLI are checked by hand; Antigravity without a turn yet. The first start of
Claude Code through `npx` downloads the adapter and takes a minute or two.

## A chat

A chat is one agent process, started in the project and stopped with the chat or the server. The
conversation is kept on the server as a log, so a reload or a second tab is sent the whole of it and a
turn goes on with no tab open.

Every agent is given Zasper's own MCP server as `zasper`, so it can read and run notebooks with no setup.

| What the agent asks | What Zasper does |
|---|---|
| `session/request_permission` | Asks the reader, and waits for the answer or for the turn to be cancelled — unless the chat's mode covers it: *Allow edits* answers edits, moves and deletes, *Allow edits and commands* commands as well, each with the agent's allow-once option. An agent with modes of its own decides what it asks, so the chat's mode then answers nothing. |
| `fs/read_text_file` | What a tab holds of the file when it has unsaved edits there, so the agent sees what the reader sees; otherwise the file on disk. |
| `fs/write_text_file` | Writes it as a save does, and open tabs say the agent wrote it. |
| `terminal/*` | Runs the command in the project, its output and errors together, and streams what it prints to its row in the panel as it comes, then how it ended. A command still running when the chat ends is stopped. |

Paths outside the project are refused.

### Signing an agent in

An agent that is installed and not signed in refuses to open a session with ACP's `Authentication
required` (-32000). Zasper says in `initialize` that it can run a terminal sign-in (`auth.terminal`),
so the agent answers its ways of signing in in `authMethods`, which the panel offers in the agent's
order and words. They are of two kinds. A terminal way is the agent's own program with arguments of its
choosing: the one picked opens a Zasper terminal in the project with that command typed in, where the
reader finishes, often in the browser, and Try again then starts the chat. A way of the agent kind (no
`type`) the agent carries out itself: the chat is started with it, and Zasper calls `authenticate`
between `initialize` and `session/new`, waiting up to ten minutes as the agent may wait on the reader in
the browser; Cancel stops the agent. When the agent refuses, its reason is shown above the ways. A
sign-in that runs out during a chat ends the chat the same way. The sign-in is the agent's, kept where it
keeps it: Zasper stores none of it.

Claude Code offers two, both signing in through its CLI: Claude Subscription (`--cli auth login
--claudeai`) and Anthropic Console (`--console`). It says who is signed in with `auth/status_update`,
which the panel shows under More as the account's label, such as the plan; the address is never kept.
It can be signed out from there (ACP's `logout`), which signs it out everywhere on the computer, and is
asked about first.

Antigravity CLI offers five: four it carries out itself, Log in with Google (it opens the browser, and
waits on a local address for Google to send it back), Log in with Gemini Enterprise, Gemini API key and
Gemini Enterprise Agent Platform, and Log in from the terminal (`agy acp --login`). Agent Platform refuses
without a Google Cloud project and location. The API key way takes the key in `authenticate`'s
`_meta.apiKey`, and agy holds it only while it runs, so its card asks for the key and Zasper keeps it in
the keychain (a 0600 file where there is none, as for a data connection's password), giving it back when
agy next asks to be signed in; Sign out forgets it. Which way takes a key is in Zasper's list of agents. It names the plan, such as "Google AI Pro", in `session/new`'s
`_meta.antigravity.tier.name` rather than in `auth/status_update`, and the panel shows that as the
account. ACP's third kind, a key from the reader passed in the agent's environment (`env_var`), is not
offered yet.

The agent's own settings for the session, such as its model, effort and mode, are ACP's session config
options. Zasper keeps the set the agent last sent, at `session/new`, `session/load`, a
`config_option_update` or the answer to `session/set_config_option`, and draws them as the agent words
them. A setting lasts for the session: a new chat starts with the agent's own defaults.

Zasper's `initialize` also asks for what it draws beyond ACP's schema, which the Go SDK has no field for:
`session.compaction`, `session.notices` and `session.configOptions.boolean`. So Claude Code sends a
compaction as `compaction_update`, a notice as `notice` and an on-or-off setting as a switch, rather than
as tool calls, text and On/Off choices.

Claude Code runs its commands itself rather than asking for a terminal. Zasper tells it that it shows
terminal output (`_meta.terminal_output`), so it sends a command's output and exit code beside the call,
and the row shows them as it does for a command run here.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/agents` | The agents Zasper knows: `id`, `name`, `vendor`, `installed`, and `install` (the command that installs one) with `then` (what to do after). |
| `GET` | `/api/agents/chats` | The chats running, each with `history` when its agent can list and open past conversations. |
| `POST` | `/api/agents/chats` | Start a chat with `{"agent": "claude-code"}`, or `{"command": "..."}` for any other, and `"sign_in"`, the id of a way the agent carries out itself, to sign it in first, with `"key"` for a way that takes one, which is then kept. `403` (`untrusted`) in a folder that is not trusted: an agent acts in the project. `403` (`sign_in_required`) with `methods` when the agent will not start until someone signs in, and `refused`, the agent's reason, when the way asked for failed. |
| `DELETE` | `/api/agents/chats/{id}` | End a chat and its agent. |
| `GET` | `/api/agents/chats/{id}/history?cursor=` | A page of the agent's past conversations in the project: `{"chats": [{id, title, updated, current}], "next"}`, through ACP's `session/list`. `400` for an agent that cannot. |
| `POST` | `/api/agents/chats/{id}/sign-out` | Sign the agent out, through ACP's `logout`, for an agent whose chat has `can_sign_out`. Answers `{"methods"}`, the ways to sign in again; the chat is left for the client to end. |
| `POST` | `/api/agents/chats/{id}/load` | Go on in a past conversation, `{"id", "title"}`, through `session/load`, with `title` as the list gave it. The chat's log starts again with the replay, and every tab's socket is closed so it reconnects to the new log. `409` while the agent is answering. |
| `GET` | `/api/agents/chats/{id}/turns/{turn}/diff?path=` | A file a turn changed, before the turn against the file now, in the shape of `/api/git/diff`, with `hash` (the file now, as a save is checked against) and `changedSince` (it changed after the turn). |
| `POST` | `/api/agents/chats/{id}/turns/{turn}/undo` | Put back the files the turn changed, those in `paths` or else all of them. `409` with `changed`, the files changed since, unless `{"anyway": true}`. The `undone` event names the files put back. |
| `GET` | `/ws/agents/chats/{id}` | **WebSocket.** The chat's log from the start, then each event as it happens. |

Each event has a `seq` and a `type`: `user` (the reader's message, in `text`), `update` (what the agent
streamed, in `update`, exactly as the agent sent it: kinds ACP's schema does not have, such as Claude
Code's `compaction_update` and `notice`, are kept as they are), `permission` (a question, with an `id`
and the agent's `request`), `answered` (its answer's `option_id`, empty when withdrawn), `turn_end` (with
ACP's `stop_reason`), `error`, `exited`, `changes` (the files the turn that has just ended changed, `changes.turn` and
`changes.files` with each `path` and `status` A, M or D), `undone` (a turn taken back, `changes.turn`),
`account` (who the agent says it is signed in as: `account.signed_in` and its `label`), `sign_in` (the agent will not go on until someone signs in, with the ways it offers in `sign_in`, each an `id`, `name`, `description`, its `kind`, `terminal` or `agent`, `takes_key` for a way that wants a key, and for a terminal way the `command` that signs in), `title` (a reopened conversation's title as the agent listed it, in `text`, which heads the chat until the agent sends a `session_info_update` with its own: Claude Code does not send it again when it replays one), `settings` (the agent's settings, the whole set, as ACP's `configOptions` in `settings`; an agent with none
logs none), and `terminal`: what a command run for the agent printed since
the last, in `terminal.output` under its `terminal.id`. The last has `exited`, with `exit_code` or
`signal`; past 256 KB the rest is not streamed, and the last has `cut` with the output's end alone.

The client sends `{"type": "prompt", "text", "mentions"}` (each mention a `kind` — `file`, `cell` or
`output` — a project `path`, a `label`, and for a cell or output its `cell_id` and `text`), `{"type": "cancel"}`, and
`{"type": "answer", "id", "option_id"}`, `{"type": "mode", "mode"}` with `ask`, `edits` or `all`, which
every tab is told of as a `mode` event, and `{"type": "setting", "id", "value"}`, a value id for a choice or
`true`/`false` for a switch, which every tab is told of as a `settings` event once the agent answers.
