import { describe, expect, it } from 'vitest';

import { applyKernelMessage, removeAnsiCodes } from './kernelMessages';
import { INotebookModel } from '@/api';

function notebookWith(cellId: string): INotebookModel {
  return {
    cells: [
      {
        cell_type: 'code',
        id: cellId,
        execution_count: null,
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

function message(msgType: string, content: unknown) {
  return {
    header: { msg_type: msgType },
    parent_header: { msg_id: 'request-1' },
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
      message('execute_input', { execution_count: 7 }),
      'cell-1'
    );
    expect(updated.cells[0].execution_count).toBe(7);
  });

  it('appends stdout streams with ansi codes removed', () => {
    const updated = applyKernelMessage(
      notebookWith('cell-1'),
      message('stream', { name: 'stdout', text: '\x1b[32mhello\x1b[0m' }),
      'cell-1'
    );
    expect(updated.cells[0].outputs).toEqual([{ text: 'hello', output_type: 'stream' }]);
  });

  it('ignores stderr streams', () => {
    const notebook = notebookWith('cell-1');
    const updated = applyKernelMessage(
      notebook,
      message('stream', { name: 'stderr', text: 'boom' }),
      'cell-1'
    );
    expect(updated).toBe(notebook);
  });

  it('appends errors with their traceback', () => {
    const updated = applyKernelMessage(
      notebookWith('cell-1'),
      message('error', {
        ename: 'ValueError',
        evalue: 'bad',
        traceback: ['line 1', 'line 2'],
      }),
      'cell-1'
    );
    expect(updated.cells[0].outputs).toEqual([
      { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['line 1', 'line 2'] },
    ]);
  });

  it('appends execute results and display data', () => {
    const data = { 'text/plain': '42' };
    const withResult = applyKernelMessage(
      notebookWith('cell-1'),
      message('execute_result', { data }),
      'cell-1'
    );
    expect(withResult.cells[0].outputs).toEqual([{ data, output_type: 'execute_result' }]);

    const withDisplay = applyKernelMessage(
      notebookWith('cell-1'),
      message('display_data', { data }),
      'cell-1'
    );
    expect(withDisplay.cells[0].outputs).toEqual([{ data }]);
  });

  it('appends to a cell whose outputs the file did not give it', () => {
    const notebook = notebookWith('cell-1');
    delete notebook.cells[0].outputs;

    const updated = applyKernelMessage(
      notebook,
      message('stream', { name: 'stdout', text: 'hello' }),
      'cell-1'
    );
    expect(updated.cells[0].outputs).toEqual([{ text: 'hello', output_type: 'stream' }]);
  });

  it('leaves cells other than the one that asked untouched', () => {
    const updated = applyKernelMessage(
      notebookWith('cell-1'),
      message('execute_input', { execution_count: 7 }),
      'other-cell'
    );
    expect(updated.cells[0].execution_count).toBeNull();
  });

  it('changes nothing for a reply that belongs to no cell', () => {
    const notebook = notebookWith('cell-1');
    const updated = applyKernelMessage(
      notebook,
      message('execute_input', { execution_count: 7 }),
      undefined
    );
    expect(updated).toBe(notebook);
  });

  it('passes over messages that carry no cell output', () => {
    const notebook = notebookWith('cell-1');
    const updated = applyKernelMessage(
      notebook,
      message('status', { execution_state: 'busy' }),
      'cell-1'
    );
    expect(updated).toBe(notebook);
  });
});
