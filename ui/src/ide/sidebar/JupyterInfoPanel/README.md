# JupyterInfoPanel

## The layout

```
┌ Jupyter info ───────────────────── ⟳ ┐   content-head: refresh
├──────────────────────────────────────┤
│ ▾ Running kernels               2    │   PanelSection: collapsible, counted
│     ● Python 3     src/demo.ipynb    │   ● only for a kernel this window is attached to
│                            ⏸  ⏻      │   Interrupt · Shut down
│       R            stats.ipynb       │   no dot: nothing here knows its state
│                            ⏸  ⏻      │
│ ▾ Terminals                     1    │
│       Terminal 1                     │   opens the tab it is for
│ ▸ Available kernels             3    │   reference material, so folded
└──────────────────────────────────────┘
```

Running things first, because they are the only rows there is anything to do about; what _could_ be
started is reference material and starts folded. Rows are `.panel-row`, the shape the source control
panel already uses — a name button filling the row, dimmed icon actions pinned right — which needs no
`<a>` and moved up into [\_panel.scss](../../../styles/_panel.scss) when a second panel wanted it.

A kernel row names its notebook from the session's `path`, and clicking it calls the same `openTab` the
file browser does, so a notebook that is already open comes forward rather than being loaded twice. A
kernel with no session has nothing to open and its name is not a button.

## Kernels without a tab

A kernel outlives the notebook's tab. Closing a tab kills nothing — as in JupyterLab — and reopening the
notebook joins the session it is still on, so `sessionForPath` in
[api/sessions.ts](../../../api/sessions.ts) is asked before any kernel is started and its answer beats
both the tab's kernel and the one the file names ([useKernelSession](../../editor/notebook/useKernelSession.ts)'s
`kernelToStart`). The POST that follows does the joining: the server answers a request for a path it is
already running with that session rather than a second one.

Which makes this panel the way to find a kernel nothing is looking at, and its shut-down button the way
to stop one. The two closes that still take a kernel with them are a file being deleted, which walks
`notebookKernelMapAtom` rather than the open tabs because the tab may have been closed hours ago, and
this panel.

## The files

| File                                                   | What is in it                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [JupyterInfoPanel.tsx](JupyterInfoPanel.tsx)           | The three sections, the empty states, and what each row's click opens.        |
| [useJupyterInfo.ts](useJupyterInfo.ts)                 | The state: the two reads merged, the poll, and one `run` for every write.     |
| [KernelList.tsx](KernelList.tsx)                       | A kernel row: status dot, display name, its notebook's path, the two actions. |
| [PanelSection.tsx](PanelSection.tsx)                   | A heading that is a disclosure button, with a count.                          |
| [ConfirmShutdownDialog.tsx](ConfirmShutdownDialog.tsx) | The dialog in front of losing everything a kernel holds in memory.            |

Outside this directory: [api/kernels.ts](../../../api/kernels.ts) and
[api/sessions.ts](../../../api/sessions.ts) are the typed clients, `kernelStatusAtom` in
[store/AppState.tsx](../../../store/AppState.tsx) is how the dot gets here, and `.kernelStatus` with its
`.ks-*` colours is in [styles/\_controls.scss](../../../styles/_controls.scss) beside `.z-button`, since
the notebook toolbar draws the same dot.

## useJupyterInfo

One hook owns everything: `{ kernels, loading, busy, error, refresh, run }`, the contract
[useGitStatus](../GitPanel/useGitStatus.ts) established.

**It reads both endpoints together** and merges them by kernel id, because a kernel listed without its
session is a row that cannot say what it is running. The merged list is sorted by name then id: the
server answers from a map, so without that the rows change places on every read.

**It reads nothing while the panel is hidden.** All seven sidebar panels stay mounted, so without the
guard a panel nobody has opened polls a server nobody is asking. Opening it reads at once, since what is
on screen is from last time. A test locks this: _'asks the server for nothing while it is hidden'_.

**It polls every five seconds while visible.** Files have a watcher; kernels have nothing. A kernel that
dies of its own accord — a segfault, a `kill` in a terminal, the machine running out of memory — is the
state this panel most needs to be right about, and polling is the only way it hears. The refresh button
exists anyway, so a change made elsewhere can be confirmed without waiting for the tick.

**Reads report into the panel; writes report as toasts.** A read happens on a timer, so a server that
has gone away would otherwise raise a toast every five seconds; that failure belongs in the panel body.
A write only happens because someone pressed something, and its failure is the answer to that press.

**`run` re-reads after every action, success or failure.** Unlike the git endpoints these answer with a
message rather than the new state, and a failure is often a kernel that has already gone — which is
exactly the change worth showing. It returns whether the action worked, because the panel has one thing
to do afterwards: on a successful shutdown it prunes `notebookKernelMapAtom`, or a notebook goes on
sending execute requests to a kernel that is gone and hears nothing back.

## The status dot

The dot is client state, and deliberately absent rather than guessed.

`KernelManager.LastActivity`, `ExecutionState` and `Connections` are declared in
[kernel_manager.go](../../../../../internal/kernel/kernel_manager.go) and **never written**, so
`/api/kernels` answers `""`, `""` and `0` for every kernel. They are left out of `IKernel` on purpose: a
field in the type is an invitation to render one of those.

What is real is the `kernelStatus` [useKernelSession](../../editor/notebook/useKernelSession.ts) computes
from IOPub `status` messages, which used to be trapped in that component. Two effects mirror it into
`kernelStatusAtom` by kernel id — one writing, one deleting on unmount — rather than touching the five
call sites that set it. **A kernel missing from that map gets no dot at all**, because a green one there
would be a state the panel invented about a kernel nothing in this window is attached to.

## Interrupt and shut down

Interrupt happens on the click; shutting down asks first. Interrupting is recoverable, and shutting down
throws away every variable in the kernel with no way back — so the dialog names the kernel and the
notebook it is running, and follows [ConfirmDiscardDialog](../GitPanel/ConfirmDiscardDialog.tsx):
`role="dialog"`, Escape to dismiss, Cancel takes focus, `.z-button-danger` on the destructive answer.

## Tests

```sh
npx vitest run src/ide/sidebar/JupyterInfoPanel   # from ui/
npx playwright test jupyterinfo.spec.ts           # from e2e/, after `npm run build` in ui/
```

[JupyterInfoPanel.test.tsx](JupyterInfoPanel.test.tsx) mocks `@/api` and covers the hidden gate and the
poll, the sections and their counts, folding, the display name and its fallback, the dot's absence for
an unattached kernel, opening a notebook and a terminal, interrupt, the shutdown dialog and the prune
behind it, a failed shutdown leaving the binding alone, and a failed read landing in the panel rather
than a toast.

[e2e/tests/jupyterinfo.spec.ts](../../../../../e2e/tests/jupyterinfo.spec.ts) is the part no mock can
reach: it starts a real kernel, checks the panel names it and its notebook, shuts it down from the
panel, and reads `GET /api/kernels` back to confirm the process is gone.
[kernelreuse.spec.ts](../../../../../e2e/tests/kernelreuse.spec.ts) covers the other half of that
lifecycle — a closed tab's kernel surviving, and a reopened notebook still knowing what `x` was.

## Not implemented

- **Kernel state from the server** — `last_activity`, `execution_state`, `connections`. Wiring them up
  is Go work in `internal/kernel`, and would let the panel show busy/idle for kernels this window is not
  attached to.
- **A terminals endpoint.** The server has a registry of terminal sessions in
  [terminal_websocket_handler.go](../../../../../internal/websocket/terminal_websocket_handler.go), but its
  keys are generated ids unrelated to the tab names, so there is no way to reattach to a terminal whose
  tab has been closed. The empty state says "in this window" because that is all this list knows.
- **Restart**, which exists nowhere in `internal/kernel` today.
- **Starting a kernel from the panel.** The launcher and the notebook's kernel picker are how a kernel is
  chosen; a third way in is a third to keep in step.
- **Kernelspec detail** — logo, language, resource directory. The launcher shows the logos; the panel
  lists names.
