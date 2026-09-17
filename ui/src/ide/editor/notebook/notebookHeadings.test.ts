import { describe, expect, it } from 'vitest';

import { NotebookCell, NotebookModel } from '@/api';

import { notebookHeadings, sectionOfCell } from './notebookHeadings';

function cell(cell_type: NotebookCell['cell_type'], source: string, id: string): NotebookCell {
  return { cell_type, source, id, metadata: {}, outputs: [], execution_count: null, reload: false };
}

function notebook(...cells: NotebookCell[]): NotebookModel {
  return { cells, nbformat: 4, nbformat_minor: 5, metadata: {} };
}

describe('notebookOutline', () => {
  it('reads the headings of markdown cells, in order, with their level', () => {
    const outline = notebookHeadings(
      notebook(
        cell('markdown', '# Sensor drift\n\nFourteen days of readings.', 'a'),
        cell('code', 'import pandas as pd', 'b'),
        cell('markdown', '### Channel 3, which drifts', 'c')
      )
    );

    expect(outline).toEqual([
      { cellIndex: 0, cellId: 'a', level: 1, text: 'Sensor drift', line: 0 },
      { cellIndex: 2, cellId: 'c', level: 3, text: 'Channel 3, which drifts', line: 0 },
    ]);
  });

  it('lists every heading in a cell that holds more than one', () => {
    const outline = notebookHeadings(
      notebook(cell('markdown', '# Calibration\n\ntext\n\n## Per-channel offsets', 'a'))
    );

    expect(outline.map((heading) => [heading.text, heading.line])).toEqual([
      ['Calibration', 0],
      ['Per-channel offsets', 4],
    ]);
  });

  // The reason this reads source rather than rendered HTML: a heading has a row while it is typed.
  it('lists a heading that is still being written', () => {
    expect(notebookHeadings(notebook(cell('markdown', '## Per-channel off', 'a')))[0].text).toBe(
      'Per-channel off'
    );
  });

  it('takes the markers out of the text', () => {
    const outline = notebookHeadings(
      notebook(
        cell('markdown', '## **Setup** the `rig` ##', 'a'),
        cell('markdown', '## See [the notes](notes.md)', 'b')
      )
    );

    expect(outline.map((heading) => heading.text)).toEqual(['Setup the rig', 'See the notes']);
  });

  it('ignores a comment inside a fenced block', () => {
    const outline = notebookHeadings(
      notebook(cell('markdown', '# Loading\n\n```python\n# not a heading\n```\n\n## After', 'a'))
    );

    expect(outline.map((heading) => heading.text)).toEqual(['Loading', 'After']);
  });

  it('ignores a hash that starts nothing', () => {
    const outline = notebookHeadings(
      notebook(
        cell('markdown', '#no space, so not a heading', 'a'),
        cell('markdown', '#', 'b'),
        cell('markdown', '####### seven hashes', 'c'),
        // Setext is deliberately unread: `---` is also a thematic break and a table's rule.
        cell('markdown', 'Underlined\n===', 'd')
      )
    );

    expect(outline).toEqual([]);
  });

  it('reads nothing out of a code or raw cell', () => {
    const outline = notebookHeadings(
      notebook(cell('code', '# a comment', 'a'), cell('raw', '# raw text', 'b'))
    );

    expect(outline).toEqual([]);
  });
});

describe('sectionOfCell', () => {
  const outline = notebookHeadings(
    notebook(
      cell('markdown', '# Sensor drift', 'a'),
      cell('code', 'readings', 'b'),
      cell('markdown', '## Calibration', 'c'),
      cell('code', 'offsets', 'd')
    )
  );

  it('is the last heading at or before the cell', () => {
    expect(sectionOfCell(outline, 0)).toBe(0);
    expect(sectionOfCell(outline, 1)).toBe(0);
    expect(sectionOfCell(outline, 2)).toBe(1);
    expect(sectionOfCell(outline, 3)).toBe(1);
  });

  it('is nothing for a notebook with no headings', () => {
    expect(sectionOfCell([], 4)).toBe(-1);
  });
});
