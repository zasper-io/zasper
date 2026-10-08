import { NotebookCell, NotebookOutput, NotebookModel } from '@/api';

import { markProducedHere } from './outputTrust';

/** A message received from, or sent to, the kernel over the websocket channel. */
export type KernelMessage = any;

export const getTimeStamp = (): string => new Date().toISOString();

/**
 * The Jupyter messaging protocol version, in the header of every message sent from here. Kept equal to
 * `kernel.ProtocolVersion` on the server, which sends messages of its own on the same sockets; a kernel
 * rejects a message whose version is missing or unparseable.
 */
export const PROTOCOL_VERSION = '5.3';

function updateCellById(
  notebook: NotebookModel,
  cellId: string,
  update: (cell: NotebookCell) => NotebookCell
): NotebookModel {
  const updatedCells = notebook.cells.map((cell) =>
    cell.id === cellId ? update({ ...cell }) : cell
  );
  return { ...notebook, cells: updatedCells };
}

/**
 * Whether this message carries something for a cell's output area, i.e. whether
 * `applyKernelMessage` would add an output for it.
 *
 * It is what a `clear_output(wait=True)` is waiting for, so it has to agree with the switch below to
 * the message: a stream the switch drops is not the replacement the clear was holding out for.
 */
export function carriesOutput(message: KernelMessage): boolean {
  switch (message.header.msg_type) {
    case 'error':
    case 'execute_result':
    case 'display_data':
    case 'stream':
      return true;
    default:
      return false;
  }
}

/**
 * When a cell's run happened, under the keys JupyterLab's Record timing writes into `metadata.execution`,
 * so that a notebook timed here reads the same there. How long the cell took is execute_input to
 * execute_reply: the kernel's own time, not the time it spent waiting behind another cell.
 */
export interface CellTiming {
  'iopub.status.busy'?: string;
  'iopub.execute_input'?: string;
  'shell.execute_reply.started'?: string;
  'shell.execute_reply'?: string;
  /** When this page sent the request, so the wait is the gap to execute_input. Never saved. */
  sent?: string;
}

/**
 * The timing a message moves a cell's run on to, or undefined when it says nothing about time. A busy
 * starts the record again, so a cell run twice holds its second run; the `sent` its run began with
 * survives it.
 *
 * The run ends at execute_reply or at the idle after it, whichever comes first: the reply is on the
 * shell channel and idle on iopub, which are not ordered, and the reply often arrives second — so a run
 * timed by its reply alone showed no time at all. Idle stands in until the reply, which then replaces
 * it, as the server's own record of an unwatched run does.
 */
export function nextTiming(
  previous: CellTiming | undefined,
  message: KernelMessage
): CellTiming | undefined {
  const date = message.header?.date;
  if (typeof date !== 'string' || date === '') {
    return undefined;
  }
  switch (message.header.msg_type) {
    case 'status':
      if (message.content?.execution_state === 'idle') {
        return previous?.['iopub.execute_input'] && !previous['shell.execute_reply']
          ? { ...previous, 'shell.execute_reply': date }
          : undefined;
      }
      if (message.content?.execution_state !== 'busy') {
        return undefined;
      }
      return { ...(previous?.sent ? { sent: previous.sent } : {}), 'iopub.status.busy': date };
    case 'execute_input':
      return { ...previous, 'iopub.execute_input': date };
    case 'execute_reply': {
      const started = message.metadata?.started;
      return {
        ...previous,
        ...(typeof started === 'string' ? { 'shell.execute_reply.started': started } : {}),
        'shell.execute_reply': date,
      };
    }
    default:
      return undefined;
  }
}

/** A cell with a message's timing written into its metadata, or null when the message has none. */
function withTiming(cell: NotebookCell, message: KernelMessage): NotebookCell | null {
  const next = nextTiming(cell.metadata?.execution as CellTiming | undefined, message);
  if (!next) {
    return null;
  }
  const { sent: _sent, ...saved } = next;
  return { ...cell, metadata: { ...cell.metadata, execution: saved } };
}

function appendOutput(cell: NotebookCell, output: NotebookOutput, replace: boolean): NotebookCell {
  markProducedHere(output);
  cell.outputs = replace ? [output] : [...(cell.outputs ?? []), output];
  return cell;
}

/**
 * Folds a kernel message into the notebook, against the cell whose execution it answers.
 *
 * `cellId` is resolved by the kernel session from the reply's `parent_header.msg_id`: a message id
 * identifies a request, a cell id a cell in the document, which outlives every request against it.
 * An undefined `cellId`, and a message carrying no cell output (status, prompts, completions),
 * change nothing here.
 *
 * `replaceOutputs` means a `clear_output(wait=True)` came before this message and this is what it was
 * waiting for: the output area is replaced rather than added to, which is how a cell rewritten in a
 * loop does not blink empty between the clear and the next frame. The flag is the caller's because
 * whether a clear is outstanding is a message that has been seen, not anything the document holds.
 *
 * `recordTiming` writes when the run happened into the cell's `metadata.execution`: see CellTiming.
 */
export function applyKernelMessage(
  notebook: NotebookModel,
  message: KernelMessage,
  cellId: string | undefined,
  replaceOutputs: boolean = false,
  recordTiming: boolean = false
): NotebookModel {
  if (!cellId) {
    return notebook;
  }

  switch (message.header.msg_type) {
    case 'execute_input':
      return updateCellById(notebook, cellId, (cell) => {
        const timed = recordTiming ? withTiming(cell, message) : null;
        return { ...(timed ?? cell), execution_count: message.content.execution_count };
      });

    case 'status':
    case 'execute_reply': {
      if (!recordTiming) {
        return notebook;
      }
      const cell = notebook.cells.find((each) => each.id === cellId);
      const timed = cell ? withTiming(cell, message) : null;
      return timed ? updateCellById(notebook, cellId, () => timed) : notebook;
    }

    case 'error':
      return updateCellById(notebook, cellId, (cell) =>
        appendOutput(
          cell,
          {
            output_type: 'error',
            ename: message.content.ename,
            evalue: message.content.evalue,
            traceback: message.content.traceback,
          },
          replaceOutputs
        )
      );

    case 'stream':
      return updateCellById(notebook, cellId, (cell) =>
        appendOutput(
          cell,
          {
            output_type: 'stream',
            // Required by nbformat, and what tells the renderer to tint stderr. Everything the kernel
            // does not write to stdout arrives there: warnings, the logging module's default handler,
            // and every tqdm progress bar.
            name: message.content.name === 'stderr' ? 'stderr' : 'stdout',
            // Kept as the kernel sent it, escapes and all. `removeAnsiCodes` was here, stripping
            // every SGR colour out of stdout before it was stored — which threw away a coloured test
            // run or a progress bar, and wrote the stripped text into the .ipynb, where Jupyter's own
            // format keeps the escapes. It existed because there was nowhere for those colours to
            // land; CellOutput.tsx resolves them through --z-ansi-* now.
            text: message.content.text,
          },
          replaceOutputs
        )
      );

    // nbformat requires `metadata` on both of these, and `execution_count` on an execute_result.
    // A kernel always sends the metadata bundle, but it is optional in the protocol and empty in
    // most messages, so it is defaulted rather than trusted — an output written without these keys
    // fails nbformat validation, and JupyterLab and nbconvert then refuse the file.
    case 'execute_result':
      return updateCellById(notebook, cellId, (cell) =>
        appendOutput(
          cell,
          {
            output_type: 'execute_result',
            data: message.content.data,
            metadata: message.content.metadata ?? {},
            execution_count: message.content.execution_count ?? cell.execution_count ?? null,
          },
          replaceOutputs
        )
      );

    case 'display_data':
      return updateCellById(notebook, cellId, (cell) =>
        appendOutput(
          cell,
          {
            output_type: 'display_data',
            data: message.content.data,
            metadata: message.content.metadata ?? {},
          },
          replaceOutputs
        )
      );

    default:
      return notebook;
  }
}

/**
 * A run the server kept while this page was not listening, from the `zasper_replay` message a kernel
 * socket opens with: one still going, or one that finished with no page attached.
 */
export interface ReplayedRun {
  msg_id: string;
  cell_id: string;
  code: string;
  execution_count: number | null;
  outputs: NotebookOutput[];
  clear_waiting: boolean;
  done: boolean;
  /** When the server saw the kernel take it up and finish it. */
  execution?: CellTiming;
}

/** A replayed run and the cell it belongs to in this document. */
export interface PlacedRun {
  cellId: string;
  run: ReplayedRun;
}

/**
 * The cell a run belongs to: the one it names, or else the only code cell holding the code that ran.
 * Two cells holding it is no answer — lighting up the wrong one is worse than lighting up none.
 */
export function findRunCell(
  cells: NotebookCell[],
  cellId: string | undefined,
  code: string
): string | undefined {
  if (cellId && cells.some((cell) => cell.id === cellId)) {
    return cellId;
  }
  const ran = code.trim();
  if (!ran) {
    return undefined;
  }
  const holding = cells.filter((cell) => cell.cell_type === 'code' && cell.source.trim() === ran);
  return holding.length === 1 ? holding[0].id : undefined;
}

/**
 * Puts replayed runs' outputs into their cells, and a finished run's times when they are recorded. A cell
 * already showing exactly that is left as the same object, so a notebook reopened after its file was
 * written is not marked unsaved.
 */
export function applyReplayedRuns(
  notebook: NotebookModel,
  placed: PlacedRun[],
  recordTiming: boolean = false
): NotebookModel {
  const runs = new Map(placed.map(({ cellId, run }) => [cellId, run]));
  let changed = false;

  const cells = notebook.cells.map((cell) => {
    const run = runs.get(cell.id);
    if (!run) {
      return cell;
    }
    const count = run.done ? run.execution_count : (run.execution_count ?? -1);
    const timing = recordTiming && run.done && run.execution ? run.execution : undefined;
    if (
      cell.execution_count === count &&
      JSON.stringify(cell.outputs ?? []) === JSON.stringify(run.outputs) &&
      (timing === undefined || JSON.stringify(cell.metadata?.execution) === JSON.stringify(timing))
    ) {
      (cell.outputs ?? []).forEach(markProducedHere);
      return cell;
    }
    changed = true;
    run.outputs.forEach(markProducedHere);
    return {
      ...cell,
      execution_count: count,
      outputs: run.outputs,
      ...(timing ? { metadata: { ...cell.metadata, execution: timing } } : {}),
    };
  });

  return changed ? { ...notebook, cells } : notebook;
}

/**
 * `msgId` identifies this request and is what the replies will carry in their `parent_header`;
 * `cellId` says which cell the code came from, and goes in the message metadata where other Jupyter
 * clients put it.
 */
export function buildExecuteRequest(
  sessionId: string,
  userName: string,
  msgId: string,
  cellId: string,
  source: string
): string {
  return JSON.stringify({
    buffers: [],
    channel: 'shell',
    content: {
      silent: false,
      store_history: true,
      user_expressions: {},
      allow_stdin: true,
      stop_on_error: true,
      code: source,
    },
    header: {
      date: getTimeStamp(),
      msg_id: msgId,
      msg_type: 'execute_request',
      session: sessionId,
      username: userName,
      version: PROTOCOL_VERSION,
    },
    metadata: {
      deletedCells: [],
      recordTiming: false,
      cellId: cellId,
      trusted: true,
    },
    parent_header: {},
  });
}

/** The `parent_header` is what addresses the reply to the request that asked; `msgId` is its own. */
export function buildInputReply(
  sessionId: string,
  userName: string,
  msgId: string,
  parentHeader: KernelMessage,
  inputValue: string
): string {
  return JSON.stringify({
    buffers: [],
    channel: 'stdin',
    content: {
      status: 'ok',
      value: inputValue,
    },
    header: {
      date: getTimeStamp(),
      msg_id: msgId,
      msg_type: 'input_reply',
      session: sessionId,
      username: userName,
      version: PROTOCOL_VERSION,
    },
    parent_header: parentHeader,
    metadata: {},
  });
}

/**
 * Binary buffers travel as base64 strings in the JSON message, in the order the kernel sent them:
 * the socket carries text, and the server marshals the frames past a message's content that way.
 * Widget libraries put array data in them — a bqplot figure's x and y arrive here and nowhere else.
 */
export function decodeBuffers(buffers: string[] | null | undefined): ArrayBuffer[] {
  return (buffers ?? []).map((encoded) => {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  });
}

function encodeBuffers(buffers: (ArrayBuffer | ArrayBufferView)[]): string[] {
  return buffers.map((buffer) => {
    const bytes =
      buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer)
        : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let binary = '';
    // A chunk at a time: fromCharCode applied to a whole array overruns the argument stack, and a
    // widget's buffers are as big as the data it is drawing.
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  });
}

/**
 * The message types widgets send: a comm's open, update and close, and the question a page that has
 * been reloaded asks about the comms already there.
 */
export type WidgetMessageType = 'comm_open' | 'comm_msg' | 'comm_close' | 'comm_info_request';

/**
 * A message from a widget: the widget protocol's open, update and close, addressed to a comm rather
 * than to a cell, or a request for the comms a kernel has. `metadata` carries the widget protocol's
 * own version, which a kernel checks.
 */
export function buildWidgetMessage(
  sessionId: string,
  userName: string,
  msgId: string,
  msgType: WidgetMessageType,
  content: unknown,
  metadata: unknown,
  buffers: (ArrayBuffer | ArrayBufferView)[]
): string {
  return JSON.stringify({
    buffers: encodeBuffers(buffers),
    channel: 'shell',
    content,
    header: {
      date: getTimeStamp(),
      msg_id: msgId,
      msg_type: msgType,
      session: sessionId,
      username: userName,
      version: PROTOCOL_VERSION,
    },
    metadata: metadata ?? {},
    parent_header: {},
  });
}

/**
 * The content of a `complete_reply`. `matches` are whole replacement texts, not suffixes —
 * completing `np.ar` returns `np.arange`, not `ange` — and they replace the source between
 * `cursor_start` and `cursor_end`.
 *
 * `_jupyter_types_experimental` is IPython's per-match kind (`function`, `instance`, `module`,
 * …). Optional by name and in practice: kernels other than IPython need not send it.
 */
export interface CompleteReply {
  status: 'ok' | 'error';
  matches: string[];
  cursor_start: number;
  cursor_end: number;
  metadata?: {
    _jupyter_types_experimental?: { start: number; end: number; text: string; type?: string }[];
  };
}

/** Asks the kernel what completes at `cursorPos`. */
export function buildCompleteRequest(
  sessionId: string,
  userName: string,
  msgId: string,
  source: string,
  cursorPos: number
): string {
  return JSON.stringify({
    channel: 'shell',
    header: {
      date: getTimeStamp(),
      msg_id: msgId,
      msg_type: 'complete_request',
      session: sessionId,
      username: userName,
      version: PROTOCOL_VERSION,
    },
    parent_header: {},
    metadata: {},
    content: {
      code: source,
      cursor_pos: cursorPos,
    },
  });
}

/**
 * The content of an `inspect_reply`: a MIME bundle about the name at the cursor. IPython's `text/plain` is
 * its `?` output — signature, type, docstring — with ANSI colours on the headings.
 */
export interface InspectReply {
  status: 'ok' | 'error';
  found: boolean;
  data?: Record<string, unknown>;
}

/** Asks the kernel about the name at `cursorPos`: 0 for `obj?`, 1 for `obj??`, which adds the source. */
export function buildInspectRequest(
  sessionId: string,
  userName: string,
  msgId: string,
  source: string,
  cursorPos: number,
  detailLevel: 0 | 1
): string {
  return JSON.stringify({
    channel: 'shell',
    header: {
      date: getTimeStamp(),
      msg_id: msgId,
      msg_type: 'inspect_request',
      session: sessionId,
      username: userName,
      version: PROTOCOL_VERSION,
    },
    parent_header: {},
    metadata: {},
    content: {
      code: source,
      cursor_pos: cursorPos,
      detail_level: detailLevel,
    },
  });
}
