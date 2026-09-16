import { setDiagnostics } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

import { markGutter, setFixLine } from './markGutter';

const DOC = 'package main\n\nfunc main() {\n\tname := nme\n}\n';

function editor(onLamp = vi.fn()) {
  const view = new EditorView({
    state: EditorState.create({ doc: DOC, extensions: [markGutter(onLamp)] }),
    parent: document.body,
  });
  return { view, onLamp };
}

/** The gutter's marks, by the line they are drawn on. */
function marks(view: EditorView): string[] {
  return [...view.dom.querySelectorAll('.cm-markGutter-mark')].map((mark) =>
    mark.className.replace('cm-markGutter-mark ', '')
  );
}

describe('markGutter', () => {
  it('marks a line with the severity of its problem', () => {
    const { view } = editor();
    const line = view.state.doc.line(4);

    view.dispatch(
      setDiagnostics(view.state, [
        { from: line.from + 9, to: line.to, severity: 'error', message: 'undefined: nme' },
      ])
    );

    expect(marks(view)).toEqual(['is-error']);
    view.destroy();
  });

  it('draws the lamp on the line a fix was found for', () => {
    const { view } = editor();

    view.dispatch({ effects: setFixLine.of(4) });

    expect(marks(view)).toEqual(['is-fix']);
    view.destroy();
  });

  // The decision the drawing settled: one column, and the problem is what it says.
  it('shows the problem on a line that has both', () => {
    const { view } = editor();
    const line = view.state.doc.line(4);

    view.dispatch(
      setDiagnostics(view.state, [
        { from: line.from, to: line.to, severity: 'warning', message: 'unused' },
      ])
    );
    view.dispatch({ effects: setFixLine.of(4) });

    expect(marks(view)).toEqual(['is-warning']);
    view.destroy();
  });

  it('offers the lamp as something to press', () => {
    const { view } = editor();

    view.dispatch({ effects: setFixLine.of(4) });

    const lamp = view.dom.querySelector('.cm-markGutter-mark.is-fix') as HTMLElement;
    expect(lamp.title).toBe('Fixes and refactors for this line');
    view.destroy();
  });

  // A line that has just been edited is a line the server has not seen, so the lamp waits.
  it('keeps the lamp with its line when the text above it changes', () => {
    const { view } = editor();
    view.dispatch({ effects: setFixLine.of(4) });

    view.dispatch({ changes: { from: 0, insert: '// a note\n' } });

    expect(marks(view)).toEqual(['is-fix']);
    expect(view.dom.querySelector('.cm-markGutter-mark.is-fix')).not.toBeNull();
    view.destroy();
  });
});
