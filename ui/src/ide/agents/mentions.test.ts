import { describe, expect, it } from 'vitest';

import { NotebookCell } from '@/api';
import { cellMention, fileMention, outputMention } from './mentions';

const cell = (outputs: NotebookCell['outputs']): NotebookCell => ({
  id: 'c2',
  cell_type: 'code',
  source: 'fit()',
  outputs,
  metadata: {},
  execution_count: 2,
  reload: false,
});

describe('mentions', () => {
  it('names a file by its name, and a cell by its number in the notebook', () => {
    expect(fileMention('data/raw.csv')).toEqual({
      kind: 'file',
      path: 'data/raw.csv',
      label: 'raw.csv',
    });
    expect(cellMention('work/fit.ipynb', cell([]), 1)).toEqual({
      kind: 'cell',
      path: 'work/fit.ipynb',
      label: 'fit.ipynb · cell 2',
      cell_id: 'c2',
      text: 'fit()',
    });
  });

  it('gives an output as the text the reader reads, an error once and without its colours', () => {
    const mention = outputMention(
      'fit.ipynb',
      cell([
        { output_type: 'stream', name: 'stdout', text: 'fitting\n' },
        { output_type: 'execute_result', data: { 'text/plain': ['0.93'] } },
        {
          output_type: 'error',
          ename: 'ValueError',
          evalue: 'bad shape',
          traceback: ['\x1b[31mValueError\x1b[0m: bad shape'],
        },
      ]),
      1
    );

    expect(mention.label).toBe('fit.ipynb · output 2');
    expect(mention.text).toBe('fitting\n\n0.93\nValueError: bad shape');
  });
});
