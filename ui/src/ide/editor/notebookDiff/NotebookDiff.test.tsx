import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DiffCell, NotebookSide } from './cellDiff';
import NotebookDiff from './NotebookDiff';

const code = (id: string, source: string, extra: Partial<DiffCell> = {}): DiffCell => ({
  id,
  cell_type: 'code',
  source,
  outputs: [],
  metadata: {},
  ...extra,
});
const stdout = (text: string) => ({ output_type: 'stream', name: 'stdout', text });
const png = (data: string) => ({
  output_type: 'display_data',
  data: { 'image/png': data, 'text/plain': '<Figure>' },
  metadata: {},
});
const side = (cells: DiffCell[]): NotebookSide => ({ cells, metadata: {}, nbformat_minor: 5 });
// A line's text, whole: the changed words inside it are marks, which split it across elements.
const lineTexts = () =>
  [...document.querySelectorAll('.nbDiff-line .t')].map((text) => text.textContent);

const before = side([
  code('a', 'import pandas as pd'),
  code('b', 'x = load("1min")', { outputs: [stdout('count 1440\n')] }),
  code('c', 'x.plot()', { outputs: [png('AAAA')] }),
  code('d', 'old()'),
  code('e', 'tail()'),
]);
const after = side([
  code('a', 'import pandas as pd'),
  code('b', 'x = load("5min")', { outputs: [stdout('count 288\n')] }),
  code('c', 'x.plot()', { outputs: [png('BBBB')], metadata: { tags: ['keep'] } }),
  code('f', 'new()'),
  code('e', 'tail()'),
]);

function renderDiff(original = before, modified = after, outputsOpen = true) {
  return render(
    <NotebookDiff
      original={original}
      modified={modified}
      sides={['HEAD', 'Working tree']}
      outputsOpen={outputsOpen}
      metadataOpen={false}
    />
  );
}

describe('NotebookDiff', () => {
  it('counts what changed, and folds the cells that did not', () => {
    renderDiff();

    expect(screen.getByText('4 of 6 cells changed')).toBeInTheDocument();
    expect(screen.getByText('1 edited')).toBeInTheDocument();
    expect(screen.getByText('1 added')).toBeInTheDocument();
    expect(screen.getByText('1 removed')).toBeInTheDocument();
    expect(screen.getByText('· outputs changed in 2 · metadata in 1')).toBeInTheDocument();

    const folds = screen.getAllByText(/unchanged cell/);
    expect(folds.map((fold) => fold.textContent)).toEqual(['1 unchanged cell', '1 unchanged cell']);
    fireEvent.click(folds[0]);
    expect(screen.getByText('import pandas as pd')).toBeInTheDocument();
  });

  it('shows the source as lines, the changed words marked', () => {
    const { container } = renderDiff();

    const marks = [...container.querySelectorAll('.nbDiff-line mark')].map(
      (mark) => mark.textContent
    );
    expect(marks).toContain('1min');
    expect(marks).toContain('5min');
  });

  it('opens output changes: printed text as lines, anything else side by side', () => {
    const { container } = renderDiff();

    expect(lineTexts()).toEqual(expect.arrayContaining(['count 1440', 'count 288']));
    const images = [...container.querySelectorAll('.nbDiff-outputs img')];
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      'data:image/png;base64,AAAA',
      'data:image/png;base64,BBBB',
    ]);
  });

  it('keeps metadata closed until it is asked for', () => {
    renderDiff();

    const toggle = screen.getByText('Metadata').closest('button') as HTMLElement;
    expect(toggle).toHaveTextContent('Metadata · tags');
    expect(screen.queryByText(/"keep"/)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText(/"keep"/)).toBeInTheDocument();
  });

  it('says so when only outputs changed', () => {
    const rerun = side(before.cells.map((cell) => ({ ...cell, outputs: [stdout('again\n')] })));
    renderDiff(before, rerun);

    expect(screen.getByText(/Only outputs changed/)).toBeInTheDocument();
  });

  it('closes every output change from the strip', () => {
    const { rerender } = renderDiff();
    expect(lineTexts()).toContain('count 288');

    rerender(
      <NotebookDiff
        original={before}
        modified={after}
        sides={['HEAD', 'Working tree']}
        outputsOpen={false}
        metadataOpen={false}
      />
    );
    expect(lineTexts()).not.toContain('count 288');
  });
});
