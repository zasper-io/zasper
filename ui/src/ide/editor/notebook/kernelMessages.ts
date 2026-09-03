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

function appendOutput(cell: ICell, output: ICellOutput): ICell {
  cell.outputs = [...(cell.outputs ?? []), output];
  return cell;
}

/**
 * Folds a kernel message into the notebook, against the cell whose execution it answers.
 *
 * `cellId` is resolved by the kernel session from the reply's `parent_header.msg_id`: a message id
 * identifies a request, a cell id a cell in the document, which outlives every request against it.
 * An undefined `cellId`, and a message carrying no cell output (status, prompts, completions),
 * change nothing here.
 */
export function applyKernelMessage(
  notebook: INotebookModel,
  message: IKernelMessage,
  cellId: string | undefined
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
        appendOutput(cell, {
          output_type: 'error',
          ename: message.content.ename,
          evalue: message.content.evalue,
          traceback: message.content.traceback,
        })
      );

    case 'stream':
      if (message.content.name !== 'stdout') {
        return notebook;
      }
      return updateCellById(notebook, cellId, (cell) =>
        appendOutput(cell, {
          text: removeAnsiCodes(message.content.text),
          output_type: 'stream',
        })
      );

    case 'execute_result':
      return updateCellById(notebook, cellId, (cell) =>
        appendOutput(cell, { data: message.content.data, output_type: 'execute_result' })
      );

    case 'display_data':
      return updateCellById(notebook, cellId, (cell) =>
        appendOutput(cell, { data: message.content.data })
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
      version: '5.2',
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
      version: '5.2',
    },
    parent_header: parentHeader,
    metadata: {},
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
      version: '5.2',
    },
    parent_header: {},
    metadata: {},
    content: {
      code: source,
      cursor_pos: cursorPos,
    },
  });
}
