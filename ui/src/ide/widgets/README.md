# widgets

Draws [ipywidgets](https://ipywidgets.readthedocs.io) in Zasper's notebook: ipywidgets' own controls,
and the libraries built on the same protocol — bqplot, ipyleaflet, ipyvolume — without Zasper knowing
anything about them.

This is a widget manager of Zasper's own rather than JupyterLab's. JupyterLab's
(`@jupyter-widgets/jupyterlab-manager`) is written against `@jupyterlab/services` for the kernel,
`@jupyterlab/rendermime` for output and Lumino for the document, which is most of JupyterLab; Zasper
has its own kernel socket, its own output components and React. What ipywidgets actually asks of a
frontend is small, though: `ManagerBase` from `@jupyter-widgets/base-manager` implements the whole
widget protocol and leaves three things abstract — how to load a widget library's JavaScript
(`loadClass`), how to make a comm (`_create_comm`), and how to ask a kernel what comms it has
(`_get_comm_info`). This package supplies those three, plus how a view reaches the page, and inherits
the rest.

## What a widget is

A widget is one object in three places at once:

| Where   | What it is                                          | Who owns it                        |
| ------- | --------------------------------------------------- | ---------------------------------- |
| Kernel  | The Python object, e.g. `IntSlider(value=3)`        | ipywidgets                         |
| Browser | A **model**: the same traits, mirrored, over a comm | `ManagerBase`, keyed by model id   |
| DOM     | A **view**: a Lumino widget attached to the page    | The React output that asked for it |

A cell's saved output holds none of that — only a mime bundle naming the model:

```json
{
  "output_type": "display_data",
  "data": {
    "application/vnd.jupyter.widget-view+json": { "model_id": "a1b2…", "version_major": 2 },
    "text/plain": "IntSlider(value=3)"
  }
}
```

So **the state lives in the kernel and nowhere else**, and a widget's model reaches the browser over
the comm that carries it. Everything below follows from that: a notebook whose kernel has been
restarted has model ids pointing at nothing, and a page that has just been reloaded has to ask.

## The pieces

| File                                     | What it does                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [widgetBridge.ts](widgetBridge.ts)       | Owns the runtime for one kernel and defers loading it until a widget turns up. The only part of this package the notebook imports eagerly. |
| [widgetManager.ts](widgetManager.ts)     | `ZasperWidgetManager`, the `ManagerBase` subclass: the model registry, the comms, view attachment and teardown.                            |
| [cdnLoader.ts](cdnLoader.ts)             | Hands out the JavaScript of a widget library, from the bundle or from jsdelivr.                                                            |
| [outputWidget.tsx](outputWidget.tsx)     | A local replacement for `@jupyter-widgets/output`, whose npm package has no browser bundle.                                                |
| [WidgetRenderer.tsx](WidgetRenderer.tsx) | The React component a `widget-view` output renders as: creates the view and hands its element to Lumino.                                   |

Three things outside the directory are part of the path:
[CellOutput.tsx](../editor/notebook/CellOutput.tsx) dispatches a `widget-view` bundle to
`WidgetRenderer` and exports `OutputBundles` for the Output widget to reuse;
[kernelMessages.ts](../editor/notebook/kernelMessages.ts) builds `comm_*` messages and base64-codes
binary buffers; [useKernelSession.ts](../editor/notebook/useKernelSession.ts) creates the bridge when
the socket opens and routes messages to it.

## The message path

```
                                   ┌──────────────────────────────────────────┐
  kernel ──comm_open/comm_msg──▶   │ useKernelSession.handleMessage           │
         ◀──comm_msg/open/close─   │  WidgetBridge.handles(msg_type)?         │
                                   └──────────────┬───────────────────────────┘
                                                  │ decodeBuffers
                                                  ▼
                                    WidgetBridge ──(import on demand)──▶ chunk
                                                  │  queue while loading
                                                  ▼
                                    ZasperWidgetManager.handleKernelMessage
                                                  │  one at a time, in order
                                                  ▼
                                    KernelComm ──▶ model ──▶ view (Lumino)
                                                                 ▲
  cell output: widget-view bundle ──▶ WidgetRenderer ────────────┘
                                        get_model → create_view → displayView
```

Outbound, a model's `save_changes` goes back through `KernelComm` → `SendComm` →
`buildWidgetMessage` → the notebook's websocket, on the shell channel.

**Binary buffers.** Widget libraries put array data in buffers past the message content — a bqplot
figure's `x` and `y` arrive there and nowhere else. The socket carries text, so the Go server
marshals those ZeroMQ frames as base64 (`[][]byte` in
[kernel_session.go](../../../../internal/kernel/kernel_session.go), which is base64 in JSON) and
`decodeBuffers`/`encodeBuffers` undo it. They are not signed — the HMAC covers the four header frames
only — which is why a kernel accepts them.

**Replies.** `answerPending` in the manager routes a message to whoever is waiting on the request it
answers, keyed by `parent_header.msg_id`, splitting on `msg.channel` (`iopub`, `stdin`, else shell).
That is not decoration: a model holds back further updates until the kernel reports itself idle, so
without it a slider moves once and then stops. `iopub` `status: idle` is what retires an entry.

## Loading a widget library

A widget library is two halves — a Python package and a JavaScript bundle — and `pip install` brings
only the Python one. Bundling every library anyone might import is not an option, so:

- `@jupyter-widgets/base`, `@jupyter-widgets/controls` (every widget in ipywidgets itself) and this
  package's Output widget are **bundled**, registered as local modules.
- Anything else is **fetched from jsdelivr** the first time a widget names it, at the name and version
  the model's own state carries (`_model_module`, `_model_module_version`) — the same convention
  ipywidgets' own HTML embedding uses:

  ```
  _model_module: "bqplot", _model_module_version: "^0.6.1"
    → https://cdn.jsdelivr.net/npm/bqplot@^0.6.1/dist/index.js
  ```

  The version is a semver _range_, caret and all, because that is what the Python package puts in the
  trait. It is passed through untouched: jsdelivr resolves ranges itself, and the alternative — asking
  npm what `^0.6.1` means — would be a second round trip to learn what the CDN already knows.

Those bundles are AMD and declare ipywidgets as an external dependency, so `cdnLoader` loads requirejs
and `define`s the local modules under their own names first. A bundle left to fetch its own
`@jupyter-widgets/base` would build models belonging to a different ipywidgets than the one displaying
them, and neither would recognise the other's.

Nothing here is loaded until it is needed. `WidgetBridge` is a small class with no widget imports; the
manager and everything under it are a dynamic `import()`, so a notebook that never displays a widget
never fetches the megabyte it would take. The trigger is either the kernel's first `comm_open` or a
saved `widget-view` output asking to be drawn.

## Ordering, and why it is a queue

`handleKernelMessage` puts every message on a promise chain and runs them one at a time. This is not
caution; without it plots come up empty.

Building a model is not instant: its state names the models it refers to, and the library it belongs to
may still be crossing the network. The `comm_msg` that fills a figure with data follows its `comm_open`
by a fraction of a millisecond. Handled as they arrived, that update reaches a comm whose model does
not exist yet and is dropped. (`@jupyterlab/services` serialises kernel messages the same way, for the
same reason.) A message that throws is logged and the queue carries on.

The one thing that is _not_ deferred is deciding which messages an Output widget claims — see below.

## The Output widget

`ipywidgets.Output` is a piece of a cell's output area that a widget holds instead: `interact` uses one
for what the function prints, and `with out:` redirects a block into it.

It is reimplemented here rather than loaded, for two reasons: `@jupyter-widgets/output` publishes no
`dist/` to npm, so unlike bqplot it cannot come from the CDN at all; and its own view renders through
a `@jupyterlab/rendermime`, which this notebook has none of. What the widget _is_ comes to two traits —
`outputs`, what to show, and `msg_id`, whose output to take — so `OutputView` rendering
`OutputBundles` into a React root is smaller than either alternative, and the outputs then look
exactly like a cell's.

The capture path is the awkward part:

1. Python's `Output.__enter__` sets `msg_id` to the id of the **executing cell's own request** — the
   same `parent_header` the cell's ordinary output carries. There is nothing in an output message
   itself to say a widget wants it.
2. `WidgetBridge.noteCapture` reads `msg_id` out of each `comm_msg` **synchronously, as it arrives**,
   into `captures: request msg_id → comm id`. This is why the registry is in the bridge and not the
   manager: a model is built over awaits and the output to capture follows by a fraction of a
   millisecond, so by the time there was a model to ask, the cell would already have shown it.
3. `useKernelSession.handleMessage` calls `captureOutput` before `applyMessage`. A claimed message goes
   to the widget and the cell shows nothing for it.
4. Delivery still goes through the manager's queue (`addToOutputWidget`), so a widget that is still
   being built gets its output once it exists.

`OutputModel.addMessage` folds a message in the way an output area does: consecutive `stream`s of the
same name are concatenated, and `clear_output(wait=True)` keeps what is on screen until there is
something to replace it — which is what stops `interact` blinking empty on every slider move. Writing
`outputs` back to the kernel (`save_changes`) is deliberate: the trait is documented as what the
frontend captured, so `out.outputs` in Python reads what is on screen.

Note that a cell's _own_ output area still ignores `clear_output`; that is item 4 in
[project-todo.md](../../../../project-todo.md).

## A page that has been reloaded

A widget lives in the kernel, so after a reload the models are gone but the kernel still has the
widgets — and the `comm_open` that would have introduced them went to the page before this one.

`WidgetBridge.manager()` therefore awaits `manager.restore()` once, unless a `comm_open` has already
arrived on this socket (a kernel that introduced its widgets here has nothing left to tell).
`restore()` is `ManagerBase._loadFromKernel()`: it opens ipywidgets' `jupyter.widget.control` comm and
asks `request_states`, which an ipywidgets 8 kernel answers with every widget's state in one message.
A kernel that never imported ipywidgets has no such target and closes the comm, which is not a failure
— ipywidgets falls back to `_get_comm_info()`, the ipywidgets ≤ 7.6 path, implemented here as a real
`comm_info_request` that resolves to `{}` after four seconds rather than leaving a notebook waiting.

This only works if the reloaded page reaches the _same_ kernel, which is a server-side matter:
`CreateSession` rejoins a session found by path
([sessions.go](../../../../internal/core/sessions.go)) instead of starting a second kernel, the way
jupyter_server does.

When there is genuinely no model — a notebook read from disk whose kernel has since been restarted —
`get_model` polls for two seconds and then throws `widget model not found`, and `WidgetRenderer` turns
that one message into _"This widget is not in the running kernel. Run the cell again to draw it."_
Every other failure is a console error plus a shorter note, because those are bugs and this is not.

## Views, and letting go of them

`displayView` attaches a view's Lumino widget to the element React gave it and remembers it, so:

- **Resize.** A widget draws itself to the size it was given, and a notebook's outputs change width
  whenever the window does, so a window `resize` posts `Widget.ResizeMessage.UnknownSize` to every
  live view.
- **Removal.** `removeView` exists because Lumino refuses to detach a widget whose node has left the
  document, and that is exactly the order React works in: it removes the output element _before_
  running the cleanup that disposes the view. Unflagging `IsAttached` first keeps that refusal — a
  throw inside a React cleanup, so one that blanks the whole IDE — from turning re-running a cell into
  a crash.
- **Teardown.** A tab closing or a kernel being replaced disposes the bridge, which disposes the
  manager: comms are dropped _before_ the models, so closing a model does not send a `comm_close` to a
  kernel that is gone, and views go through `removeView` for the reason above.

## CSS

Two stylesheets are imported by `widgetManager.ts`, so they arrive with the widget chunk rather than
with the app:

- `@jupyter-widgets/controls/css/widgets.css` — ipywidgets' own look.
- `@lumino/widgets/style/widget.css` — two rules, both load-bearing. `position: relative` is what a
  bqplot figure's absolutely positioned `.svg-background` sizes itself against; without it the
  background took the size of the cell's output area and the plot overflowed it with scrollbars.
  `.lm-mod-hidden` is how a widget asked to hide itself does so.

## Not implemented

- **No widget state in the saved notebook.** Jupyter can write
  `metadata.widgets["application/vnd.jupyter.widget-state+json"]`, which is what makes widgets render
  statically on nbviewer and GitHub. Zasper does not, so a notebook opened without a running kernel
  shows the "run the cell again" placeholder rather than a frozen widget. `ManagerBase` has
  `get_state`, so this is a save-path change rather than new protocol work.
- **No rendermime.** Outputs inside an Output widget render through `OutputBundles`, so they support
  exactly what a cell supports: nested widgets, `application/vnd.plotly.v1+json`, `text/html` (scripts
  re-executed), `image/png`, `text/plain` and `application/json`. No LaTeX, SVG or markdown renderers,
  and no mime-renderer extensions.
- **No embedding or HTML export** (`@jupyter-widgets/html-manager`'s other half).
- **One Output widget per request.** `captures` maps a request's `msg_id` to a single comm id, so two
  Output widgets capturing the same cell — nested `with out1:` inside `with out2:` — both claim it and
  the most recent one wins, rather than the innermost getting it and the outer resuming afterwards.
  Fixing it means a stack per request rather than an entry.
