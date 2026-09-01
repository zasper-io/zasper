import { describe, expect, it } from 'vitest';

import { applyKernelMessage, removeAnsiCodes } from '../ide/editor/notebook/kernelMessages';
import { INotebookModel } from '../ide/editor/notebook/types';

function notebookWith(cellId: string): INotebookModel {
  return {
    cells: [
      {
        cell_type: 'code',
        id: cellId,
        execution_count: 0,
        source: 'print(1)',
        outputs: [],
        metadata: {},
        reload: false,
      },
    ],
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
  };
}

function message(msgType: string, cellId: string, content: unknown) {
  return {
    header: { msg_type: msgType },
    parent_header: { msg_id: cellId },
    content,
  };
}

describe('removeAnsiCodes', () => {
  it('strips SGR colour escapes', () => {
    expect(removeAnsiCodes('\x1b[31mred\x1b[0m')).toBe('red');
  });
});

describe('applyKernelMessage', () => {
  it('records the execution count of the requesting cell', () => {
    const updated = applyKernelMessage(
      notebookWith('cell-1'),
      message('execute_input', 'cell-1', { execution_count: 7 })
    );
    expect(updated.cells[0].execution_count).toBe(7);
  });

  it('appends stdout streams with ansi codes removed', () => {
    const updated = applyKernelMessage(
      notebookWith('cell-1'),
      message('stream', 'cell-1', { name: 'stdout', text: '\x1b[32mhello\x1b[0m' })
    );
    expect(updated.cells[0].outputs).toEqual([{ text: 'hello', output_type: 'stream' }]);
  });

  it('ignores stderr streams', () => {
    const notebook = notebookWith('cell-1');
    const updated = applyKernelMessage(
      notebook,
      message('stream', 'cell-1', { name: 'stderr', text: 'boom' })
    );
    expect(updated).toBe(notebook);
  });

  it('appends errors with their traceback', () => {
    const updated = applyKernelMessage(
      notebookWith('cell-1'),
      message('error', 'cell-1', {
        ename: 'ValueError',
        evalue: 'bad',
        traceback: ['line 1', 'line 2'],
      })
    );
    expect(updated.cells[0].outputs).toEqual([
      { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['line 1', 'line 2'] },
    ]);
  });

  it('appends execute results and display data', () => {
    const data = { 'text/plain': '42' };
    const withResult = applyKernelMessage(
      notebookWith('cell-1'),
      message('execute_result', 'cell-1', { data })
    );
    expect(withResult.cells[0].outputs).toEqual([{ data, output_type: 'execute_result' }]);

    const withDisplay = applyKernelMessage(
      notebookWith('cell-1'),
      message('display_data', 'cell-1', { data })
    );
    expect(withDisplay.cells[0].outputs).toEqual([{ data }]);
  });

  it('leaves cells belonging to other requests untouched', () => {
    const updated = applyKernelMessage(
      notebookWith('cell-1'),
      message('execute_input', 'other-cell', { execution_count: 7 })
    );
    expect(updated.cells[0].execution_count).toBe(0);
  });

  it('passes over messages that carry no cell output', () => {
    const notebook = notebookWith('cell-1');
    const updated = applyKernelMessage(
      notebook,
      message('status', 'cell-1', { execution_state: 'busy' })
    );
    expect(updated).toBe(notebook);
  });
});
