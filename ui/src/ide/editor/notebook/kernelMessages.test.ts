import { describe, expect, it } from 'vitest';

import { applyKernelMessage, carriesOutput } from './kernelMessages';
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

describe('applyKernelMessage', () => {
  it('records the execution count of the requesting cell', () => {
    const updated = applyKernelMessage(
      notebookWith('cell-1'),
      message('execute_input', { execution_count: 7 }),
      'cell-1'
    );
    expect(updated.cells[0].execution_count).toBe(7);
  });

  // The escapes are the kernel's, and they are kept: they used to be stripped here, which threw away
  // the colour of a test run and wrote the stripped text into the .ipynb. CellOutput.tsx turns them
  // into `.ansi-*` classes that the theme can reach.
  it('appends stdout streams as the kernel sent them, escapes and all', () => {
    const updated = applyKernelMessage(
      notebookWith('cell-1'),
      message('stream', { name: 'stdout', text: '\x1b[32mhello\x1b[0m' }),
      'cell-1'
    );
    expect(updated.cells[0].outputs).toEqual([
      { output_type: 'stream', name: 'stdout', text: '\x1b[32mhello\x1b[0m' },
    ]);
  });

  // Warnings, the logging module and every tqdm progress bar come down this channel. They used to be
  // dropped, so a cell that only warned looked like a cell that produced nothing at all.
  it('keeps stderr streams, named so the renderer can tint them', () => {
    const updated = applyKernelMessage(
      notebookWith('cell-1'),
      message('stream', { name: 'stderr', text: 'boom' }),
      'cell-1'
    );
    expect(updated.cells[0].outputs).toEqual([
      { output_type: 'stream', name: 'stderr', text: 'boom' },
    ]);
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

  // nbformat requires `metadata` on both, and `execution_count` on an execute_result. Writing them
  // without those keys produced .ipynb files that nbformat.validate() rejects and nbconvert refuses.
  it('appends execute results and display data in the shape nbformat requires', () => {
    const data = { 'text/plain': '42' };
    const withResult = applyKernelMessage(
      notebookWith('cell-1'),
      message('execute_result', { data, execution_count: 3 }),
      'cell-1'
    );
    expect(withResult.cells[0].outputs).toEqual([
      { output_type: 'execute_result', data, metadata: {}, execution_count: 3 },
    ]);

    const withDisplay = applyKernelMessage(
      notebookWith('cell-1'),
      message('display_data', { data, metadata: { 'image/png': { width: 40 } } }),
      'cell-1'
    );
    expect(withDisplay.cells[0].outputs).toEqual([
      { output_type: 'display_data', data, metadata: { 'image/png': { width: 40 } } },
    ]);
  });

  it('appends to a cell whose outputs the file did not give it', () => {
    const notebook = notebookWith('cell-1');
    delete notebook.cells[0].outputs;

    const updated = applyKernelMessage(
      notebook,
      message('stream', { name: 'stdout', text: 'hello' }),
      'cell-1'
    );
    expect(updated.cells[0].outputs).toEqual([
      { output_type: 'stream', name: 'stdout', text: 'hello' },
    ]);
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

  it('replaces what a cell shows for the output a waiting clear was held for', () => {
    const notebook = applyKernelMessage(
      notebookWith('cell-1'),
      message('stream', { name: 'stdout', text: 'frame 1' }),
      'cell-1'
    );

    const updated = applyKernelMessage(
      notebook,
      message('stream', { name: 'stdout', text: 'frame 2' }),
      'cell-1',
      true
    );

    expect(updated.cells[0].outputs).toEqual([
      { output_type: 'stream', name: 'stdout', text: 'frame 2' },
    ]);
  });
});

describe('carriesOutput', () => {
  // What a clear_output(wait=True) is waiting for, so it has to agree with applyKernelMessage: a
  // message it drops is not a replacement, and a clear held for one would never be honoured.
  it('is true of exactly the messages that produce an output', () => {
    expect(carriesOutput(message('stream', { name: 'stdout', text: 'x' }))).toBe(true);
    expect(carriesOutput(message('execute_result', { data: {} }))).toBe(true);
    expect(carriesOutput(message('display_data', { data: {} }))).toBe(true);
    expect(carriesOutput(message('error', { ename: 'ValueError' }))).toBe(true);

    expect(carriesOutput(message('stream', { name: 'stderr', text: 'x' }))).toBe(true);

    expect(carriesOutput(message('execute_input', { execution_count: 1 }))).toBe(false);
    expect(carriesOutput(message('status', { execution_state: 'idle' }))).toBe(false);
    expect(carriesOutput(message('clear_output', { wait: true }))).toBe(false);
  });
});
