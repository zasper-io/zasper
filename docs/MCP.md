# Zasper as an MCP server

Any agent that speaks MCP — Claude Code, Codex, Gemini CLI, and others — can read and change the notebooks
in a Zasper project and run their cells in the notebook's live kernel. A notebook open in Zasper shows each
change and each run as it happens, in the cell it is for, under the agent's name.

Files, search and git are left to the agent's own tools, which already do them well. What only Zasper has
is the kernel, and outputs an agent can see.

## Connecting an agent

Start Zasper in the project as usual. Then point the agent at `zasper mcp`, run from inside the project:

| Agent | How |
|---|---|
| Claude Code | `claude mcp add zasper -- zasper mcp` |
| Codex | in `~/.codex/config.toml`: `[mcp_servers.zasper]` with `command = "zasper"` and `args = ["mcp"]` |
| Gemini CLI | in `settings.json`: `"mcpServers": {"zasper": {"command": "zasper", "args": ["mcp"]}}` |
| Anything else | a stdio MCP server whose command is `zasper mcp` |

`zasper mcp` finds the running server for the folder it is started in, signs in to it and relays MCP on
stdin and stdout. Each server records itself in `~/.zasper/runtime/server-<pid>.json`, readable by you
alone, while it runs. When several servers are running it takes the one whose project holds the current
folder; when none is running it says so.

An agent that speaks streamable HTTP can also use `POST /mcp` directly, signed in like any `/api` request.

## Tools

| Tool | What it does |
|---|---|
| `list_notebooks` | The project's notebooks, and whether each has a kernel running. |
| `read_notebook` | A notebook's cells with their ids, sources and outputs. Plots come back as images, long streams as their end, a widget by name. Returns the notebook's hash. |
| `edit_notebook` | Insert, edit, delete and move cells by id, written once. Pass the hash from `read_notebook`: a notebook changed since is not written over. |
| `run_cell` | Run a code cell in the notebook's kernel, starting the kernel the notebook names if none is running, and return its outputs. Waits 60 seconds by default, 10 minutes at most; past that the run carries on. |
| `interrupt_kernel` | Stop the cell the notebook's kernel is running. |
| `list_variables` | The kernel's variables, with types and shapes. Python kernels. |
| `describe_dataframe` | A dataframe's or array's columns, their statistics, and its first rows. |

## What the user sees, and what keeps them safe

- **Edits are merged per cell.** A cell the user has not touched takes the agent's version in place; a cell
  they are editing at the same time asks them, on the cell, which to keep. The band names the agent:
  "claude-code changed drift.ipynb".
- **Runs show in their cell**, with the stop button that interrupts them, whoever started them.
- **Nothing runs in a folder that is not trusted.** `run_cell` is refused until the user trusts the
  project, as a kernel started any other way is. See [TRUST.md](TRUST.md).
- **`input()` cannot be answered** in a run an agent starts: it fails at once rather than waiting.
- Zasper sends nothing anywhere: the agent is the user's own, with their own subscription, and talks to
  this machine's server only.
