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
| `GET` | `/api/agents/chats` | The chats running. |
| `POST` | `/api/agents/chats` | Start a chat with `{"agent": "claude-code"}`, or `{"command": "..."}` for any other. `403` (`untrusted`) in a folder that is not trusted: an agent acts in the project. |
| `DELETE` | `/api/agents/chats/{id}` | End a chat and its agent. |
| `GET` | `/ws/agents/chats/{id}` | **WebSocket.** The chat's log from the start, then each event as it happens. |

Each event has a `seq` and a `type`: `user` (the reader's message, in `text`), `update` (what the agent
streamed, exactly as ACP's `session/update` has it, in `update`), `permission` (a question, with an `id`
and the agent's `request`), `answered` (its answer's `option_id`, empty when withdrawn), `turn_end` (with
ACP's `stop_reason`), `error`, `exited`, and `terminal`: what a command run for the agent printed since
the last, in `terminal.output` under its `terminal.id`. The last has `exited`, with `exit_code` or
`signal`; past 256 KB the rest is not streamed, and the last has `cut` with the output's end alone.

The client sends `{"type": "prompt", "text"}`, `{"type": "cancel"}`, and
`{"type": "answer", "id", "option_id"}`, and `{"type": "mode", "mode"}` with `ask`, `edits` or `all`, which
every tab is told of as a `mode` event.
