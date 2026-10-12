# Hosting agents

Zasper can run a coding agent the user already has — Claude Code, Gemini CLI, Codex — inside the project,
and hold the conversation with it, over the [Agent Client Protocol](https://agentclientprotocol.com).
The agent is the user's own, signed in with their own account; Zasper stores nothing of it and sends
nothing anywhere. For an agent that runs on its own and only uses Zasper's tools, see [MCP.md](MCP.md).

## The panel

The bot in the topbar opens the agent panel on the right of the editor, beside the file tree. With no
chat it lists the agents Zasper knows, found or with how to install them; picking one starts it. The
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
turn against what the turn left. **Undo this turn** puts them back as they were before it: a file it
added is removed, one it deleted comes back. A file that has changed since the turn is named first, and
put back only when the reader says to. Open tabs take the files back as they take any change on disk.

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
| Gemini CLI | `gemini --experimental-acp` | `npm install -g @google/gemini-cli` |
| Codex | `codex-acp` | install `codex-acp` beside the `codex` CLI |
| Any other | the command line given | |

Claude Code is the one checked by hand so far. The first start through `npx` downloads the adapter and
takes a minute or two.

## A chat

A chat is one agent process, started in the project and stopped with the chat or the server. The
conversation is kept on the server as a log, so a reload or a second tab is sent the whole of it and a
turn goes on with no tab open.

Every agent is given Zasper's own MCP server as `zasper`, so it can read and run notebooks with no setup.

| What the agent asks | What Zasper does |
|---|---|
| `session/request_permission` | Asks the reader, and waits for the answer or for the turn to be cancelled — unless the chat's mode covers it: *Allow edits* answers edits, moves and deletes, *Allow edits and commands* commands as well, each with the agent's allow-once option. |
| `fs/read_text_file` | What a tab holds of the file when it has unsaved edits there, so the agent sees what the reader sees; otherwise the file on disk. |
| `fs/write_text_file` | Writes it as a save does, and open tabs say the agent wrote it. |
| `terminal/*` | Runs the command in the project, its output and errors together, and streams what it prints to its row in the panel as it comes, then how it ended. A command still running when the chat ends is stopped. |

Paths outside the project are refused.

Claude Code runs its commands itself rather than asking for a terminal. Zasper tells it that it shows
terminal output (`_meta.terminal_output`), so it sends a command's output and exit code beside the call,
and the row shows them as it does for a command run here.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/agents` | The agents Zasper knows: `id`, `name`, `installed`, `hint`. |
| `GET` | `/api/agents/chats` | The chats running, each with `history` when its agent can list and open past conversations. |
| `POST` | `/api/agents/chats` | Start a chat with `{"agent": "claude-code"}`, or `{"command": "..."}` for any other. `403` (`untrusted`) in a folder that is not trusted: an agent acts in the project. |
| `DELETE` | `/api/agents/chats/{id}` | End a chat and its agent. |
| `GET` | `/api/agents/chats/{id}/history?cursor=` | A page of the agent's past conversations in the project: `{"chats": [{id, title, updated, current}], "next"}`, through ACP's `session/list`. `400` for an agent that cannot. |
| `POST` | `/api/agents/chats/{id}/load` | Go on in a past conversation, `{"id"}`, through `session/load`. The chat's log starts again with the replay, and every tab's socket is closed so it reconnects to the new log. `409` while the agent is answering. |
| `GET` | `/api/agents/chats/{id}/turns/{turn}/diff?path=` | A file a turn changed, before and after the turn, in the shape of `/api/git/diff`. |
| `POST` | `/api/agents/chats/{id}/turns/{turn}/undo` | Put back the files the turn changed. `409` with `changed`, the files changed since, unless `{"anyway": true}`. |
| `GET` | `/ws/agents/chats/{id}` | **WebSocket.** The chat's log from the start, then each event as it happens. |

Each event has a `seq` and a `type`: `user` (the reader's message, in `text`), `update` (what the agent
streamed, exactly as ACP's `session/update` has it, in `update`), `permission` (a question, with an `id`
and the agent's `request`), `answered` (its answer's `option_id`, empty when withdrawn), `turn_end` (with
ACP's `stop_reason`), `error`, `exited`, `changes` (the files the turn that has just ended changed, `changes.turn` and
`changes.files` with each `path` and `status` A, M or D), `undone` (a turn taken back, `changes.turn`),
and `terminal`: what a command run for the agent printed since
the last, in `terminal.output` under its `terminal.id`. The last has `exited`, with `exit_code` or
`signal`; past 256 KB the rest is not streamed, and the last has `cut` with the output's end alone.

The client sends `{"type": "prompt", "text", "mentions"}` (each mention a `kind` — `file`, `cell` or
`output` — a project `path`, a `label`, and for a cell or output its `cell_id` and `text`), `{"type": "cancel"}`, and
`{"type": "answer", "id", "option_id"}`, and `{"type": "mode", "mode"}` with `ask`, `edits` or `all`, which
every tab is told of as a `mode` event.
