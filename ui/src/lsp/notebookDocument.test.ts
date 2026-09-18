import { describe, expect, it } from 'vitest';

import { buildVirtualDocument, fromVirtual, maskIPython, toVirtual } from './notebookDocument';

describe('maskIPython', () => {
  it('keeps every line, and hides the ones that are not Python', () => {
    const source = ['%matplotlib inline', 'import os', '!ls -la', 'files = !ls', 'os.path?'].join(
      '\n'
    );
    const { text, hidden } = maskIPython(source);

    expect(text.split('\n')).toEqual(['pass', 'import os', 'pass', 'files = eval("")', 'pass']);
    expect([...hidden]).toEqual([0, 2, 3, 4]);
  });

  it('keeps the indent, so a magic inside a block leaves the block valid', () => {
    expect(maskIPython('for i in range(3):\n    %time f(i)').text).toBe(
      'for i in range(3):\n    pass'
    );
  });

  it('leaves an operator that starts a continued line alone', () => {
    const source = 'x = (a\n     % b)\ny = a \\\n  % b';
    expect(maskIPython(source)).toEqual({ text: source, hidden: new Set() });
  });

  it('hides only the magic of a cell whose body is Python, and the whole of any other', () => {
    expect(maskIPython('%%time\nx = 1')).toEqual({ text: '\nx = 1', hidden: new Set([0]) });
    expect(maskIPython('%%bash\nls\npwd')).toEqual({ text: '\n\n', hidden: new Set([0, 1, 2]) });
  });

  it('gives a formatter comments it can be handed back by', () => {
    expect(maskIPython('if x:\n    !ls', (line) => `# hidden-${line}`).text).toBe(
      'if x:\n    # hidden-1'
    );
  });
});

describe('the virtual document', () => {
  const doc = buildVirtualDocument(
    [
      { id: 'a', index: 0, source: 'import os\n%pwd' },
      { id: 'b', index: 2, source: 'os.getcwd()' },
    ],
    true
  );

  it('joins the cells with two blank lines, as a module would have them', () => {
    expect(doc.text).toBe('import os\npass\n\n\nos.getcwd()\n');
    expect(doc.cells.map((cell) => [cell.id, cell.start, cell.lines])).toEqual([
      ['a', 0, 2],
      ['b', 4, 1],
    ]);
  });

  it('maps a place in a cell there and back', () => {
    expect(toVirtual(doc, 'b', { line: 0, character: 3 })).toEqual({ line: 4, character: 3 });
    const back = fromVirtual(doc, { line: 4, character: 3 });
    expect([back?.cell.id, back?.cell.index, back?.line, back?.character]).toEqual(['b', 2, 0, 3]);
  });

  it('has nothing to say about the gaps, or about a line the server was not shown', () => {
    expect(fromVirtual(doc, { line: 2, character: 0 })).toBeNull();
    expect(fromVirtual(doc, { line: 1, character: 0 })).toBeNull();
    expect(toVirtual(doc, 'missing', { line: 0, character: 0 })).toBeNull();
  });

  it('leaves another language as written', () => {
    expect(buildVirtualDocument([{ id: 'a', index: 0, source: '%in% x' }], false).text).toBe(
      '%in% x\n'
    );
  });
});
