import { ICell, ICellOutput, INotebookModel } from '@/api';

/** A message received from, or sent to, the kernel over the websocket channel. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IKernelMessage = any;

/** Strips the SGR colour escapes kernels embed in stream output. */
export function removeAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export const getTimeStamp = (): string => new Date().toISOString();

/**
 * The Jupyter messaging protocol version, in the header of every message sent from here. Kept equal to
 * `kernel.ProtocolVersion` on the server, which sends messages of its own on the same sockets; a kernel
 * rejects a message whose version is missing or unparseable.
 */
export const PROTOCOL_VERSION = '5.3';

function updateCellById(
  notebook: INotebookModel,
  cellId: string,
  update: (cell: ICell) => ICell
): INotebookModel {
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
export function carriesOutput(message: IKernelMessage): boolean {
  switch (message.header.msg_type) {
    case 'error':
    case 'execute_result':
    case 'display_data':
      return true;
    case 'stream':
      return message.content.name === 'stdout';
    default:
      return false;
  }
}

function appendOutput(cell: ICell, output: ICellOutput, replace: boolean): ICell {
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
 */
export function applyKernelMessage(
  notebook: INotebookModel,
  message: IKernelMessage,
  cellId: string | undefined,
  replaceOutputs: boolean = false
): INotebookModel {
  if (!cellId) {
    return notebook;
  }

  switch (message.header.msg_type) {
    case 'execute_input':
      return updateCellById(notebook, cellId, (cell) => {
        cell.execution_count = message.content.execution_count;
        return cell;
      });

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
      if (message.content.name !== 'stdout') {
        return notebook;
      }
      return updateCellById(notebook, cellId, (cell) =>
        appendOutput(
          cell,
          {
            text: removeAnsiCodes(message.content.text),
            output_type: 'stream',
          },
          replaceOutputs
        )
      );

    case 'execute_result':
      return updateCellById(notebook, cellId, (cell) =>
        appendOutput(
          cell,
          { data: message.content.data, output_type: 'execute_result' },
          replaceOutputs
        )
      );

    case 'display_data':
      return updateCellById(notebook, cellId, (cell) =>
        appendOutput(cell, { data: message.content.data }, replaceOutputs)
      );

    default:
      return notebook;
  }
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
  parentHeader: IKernelMessage,
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
export interface ICompleteReply {
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
