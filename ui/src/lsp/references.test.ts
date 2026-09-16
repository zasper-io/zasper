import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { symbolAt } from './references';

function cursorAt(doc: string, at: number): EditorView {
  return new EditorView({ state: EditorState.create({ doc, selection: { anchor: at } }) });
}

describe('symbolAt', () => {
  it('reads the whole name the cursor is inside', () => {
    expect(symbolAt(cursorAt('fmt.Println(greet(name))', 15))).toBe('greet');
  });

  it('reads a name the cursor is at the end of', () => {
    expect(symbolAt(cursorAt('total_rows = 1', 10))).toBe('total_rows');
  });

  it('is empty where the cursor is on nothing', () => {
    expect(symbolAt(cursorAt('x = 1 + 2', 3))).toBe('');
  });

  // A selection is the question, however it was made: two names selected are asked about as typed.
  it('takes a selection as it is', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'greet(name)', selection: { anchor: 0, head: 5 } }),
    });

    expect(symbolAt(view)).toBe('greet');
  });

  // A name in a language that is not written in ASCII is still one name.
  it('reads a name outside ASCII', () => {
    expect(symbolAt(cursorAt('grüße = 1', 3))).toBe('grüße');
  });
});
