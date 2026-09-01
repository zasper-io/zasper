import { ICell, ICellOutput, INotebookModel } from './types';

/** A message received from, or sent to, the kernel over the websocket channel. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IKernelMessage = any;

/** Strips the SGR colour escapes kernels embed in stream output. */
export function removeAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export const getTimeStamp = (): string => new Date().toISOString();

/** Cells are matched to kernel replies by using the cell id as the request msg_id. */
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
  if (!cell.outputs.length) cell.outputs = [];
  cell.outputs.push(output);
  return cell;
}

/**
 * Folds a kernel message into the notebook. Messages that carry no cell output
 * (status, prompts, completions) leave the notebook untouched and are handled by
 * the kernel session hook instead.
 */
export function applyKernelMessage(
  notebook: INotebookModel,
  message: IKernelMessage
): INotebookModel {
  switch (message.header.msg_type) {
    case 'execute_input':
      return updateCellById(notebook, message.parent_header.msg_id, (cell) => {
        cell.execution_count = message.content.execution_count;
        return cell;
      });

    case 'error':
      return updateCellById(notebook, message.parent_header.msg_id, (cell) =>
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
      return updateCellById(notebook, message.parent_header.msg_id, (cell) =>
        appendOutput(cell, {
          text: removeAnsiCodes(message.content.text),
          output_type: 'stream',
        })
      );

    case 'execute_result':
      return updateCellById(notebook, message.parent_header.msg_id, (cell) =>
        appendOutput(cell, { data: message.content.data, output_type: 'execute_result' })
      );

    case 'display_data':
      return updateCellById(notebook, message.parent_header.msg_id, (cell) =>
        appendOutput(cell, { data: message.content.data })
      );

    default:
      return notebook;
  }
}

export function buildExecuteRequest(
  sessionId: string,
  userName: string,
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
      msg_id: cellId,
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

export function buildInputReply(
  sessionId: string,
  userName: string,
  cellId: string,
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
      msg_id: cellId,
      msg_type: 'input_reply',
      session: sessionId,
      username: userName,
      version: '5.2',
    },
    parent_header: parentHeader,
    metadata: {},
  });
}

export function buildInspectRequest(
  sessionId: string,
  userName: string,
  source: string,
  cursorPos: number
): string {
  return JSON.stringify({
    channel: 'shell',
    header: {
      date: getTimeStamp(),
      msg_id: '5cfe8270-a5b0-4706-868e-4249c852949e',
      msg_type: 'inspect_request',
      session: sessionId,
      username: userName,
      version: '5.2',
    },
    parent_header: {},
    metadata: {},
    content: {
      code: source,
      cursor_pos: cursorPos,
      detail_level: 0,
    },
  });
}
