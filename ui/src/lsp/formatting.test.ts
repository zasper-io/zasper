import { ChangeSet, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { formattingChanges } from './formatting';

const at = (line: number, character: number) => ({ line, character });

describe('formattingChanges', () => {
  const sent = Text.of(['func main()  {', '\tx := 1', '}']);

  it('reads each edit against the document the server was sent', () => {
    const changes = formattingChanges(sent, ChangeSet.empty(sent.length).desc, [
      { range: { start: at(0, 11), end: at(0, 13) }, newText: ' ' },
    ]);

    expect(changes).toEqual([{ from: 11, to: 13, insert: ' ' }]);
  });

  // The reader can type while the server is answering, and the edit still belongs where the text moved to.
  it('carries an edit across what was typed since', () => {
    const typed = ChangeSet.of([{ from: 0, insert: '// a\n' }], sent.length);

    const changes = formattingChanges(sent, typed.desc, [
      { range: { start: at(1, 0), end: at(1, 1) }, newText: '    ' },
    ]);

    expect(changes).toEqual([{ from: 20, to: 21, insert: '    ' }]);
  });
});
