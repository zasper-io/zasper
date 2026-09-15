import { fireEvent, render, screen } from '@testing-library/react';
import { getSearchQuery, search } from '@codemirror/search';
import { EditorState, TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FindCard from './FindCard';

/**
 * Enough of an EditorView for the search commands, which read `state` and call `dispatch`: CodeMirror
 * cannot mount under jsdom, and its search is state, not layout.
 */
function fakeView(doc: string) {
  let state = EditorState.create({ doc, extensions: [search()] });
  return {
    get state() {
      return state;
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state;
    },
    focus: () => {},
  } as unknown as EditorView;
}

const onClose = vi.fn();

function renderCard(view: EditorView) {
  render(
    <Provider>
      <FindCard view={view} seed="" focusRequest={1} onClose={onClose} />
    </Provider>
  );
}

function field(): HTMLElement {
  return screen.getByLabelText('Find');
}

describe('FindCard', () => {
  beforeEach(() => {
    onClose.mockReset();
  });

  it('tells CodeMirror what to look for, and counts it', () => {
    const view = fakeView('row one\nROW two\nrow three\n');
    renderCard(view);

    fireEvent.change(field(), { target: { value: 'row' } });

    expect(getSearchQuery(view.state).search).toBe('row');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('steps to the next match on Enter, and back on Shift-Enter', () => {
    const view = fakeView('row one\nrow two\n');
    renderCard(view);
    fireEvent.change(field(), { target: { value: 'row' } });

    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(view.state.selection.main.from).toBe(0);

    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(view.state.selection.main.from).toBe(8);

    fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true });
    expect(view.state.selection.main.from).toBe(0);
  });

  it('says when a query finds nothing', () => {
    const view = fakeView('row one\n');
    renderCard(view);

    fireEvent.change(field(), { target: { value: 'column' } });

    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('asks for the case to match, and counts fewer', () => {
    const view = fakeView('row one\nROW two\n');
    renderCard(view);
    fireEvent.change(field(), { target: { value: 'row' } });
    expect(screen.getByText('1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Match case'));

    expect(getSearchQuery(view.state).caseSensitive).toBe(true);
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
  });

  // The replace row is not there until it is asked for: most finds are not replacements.
  it('opens the replace row, and replaces every match', () => {
    const view = fakeView('row one\nrow two\n');
    renderCard(view);
    fireEvent.change(field(), { target: { value: 'row' } });
    expect(screen.queryByLabelText('Replace')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Show replace'));
    fireEvent.change(screen.getByLabelText('Replace'), { target: { value: 'line' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }));

    expect(view.state.doc.toString()).toBe('line one\nline two\n');
  });

  it('closes on Escape, and stops looking for anything', () => {
    const view = fakeView('row one\n');
    const { unmount } = render(
      <Provider>
        <FindCard view={view} seed="" focusRequest={1} onClose={onClose} />
      </Provider>
    );
    fireEvent.change(field(), { target: { value: 'row' } });

    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();

    // The card going is what clears the marks: nothing is left highlighted behind it.
    unmount();
    expect(getSearchQuery(view.state).search).toBe('');
  });

  it('takes the field with the selection in it', () => {
    const view = fakeView('row one\n');
    render(
      <Provider>
        <FindCard view={view} seed="one" focusRequest={1} onClose={onClose} />
      </Provider>
    );

    expect(field()).toHaveValue('one');
    expect(field()).toHaveFocus();
  });

  // A match pressed in the search panel opens the card searching for what the panel searched for, with
  // the cursor left in the editor on that match.
  it('opens with the toggles it is given, and can leave the focus where it is', () => {
    const view = fakeView('Row row\n');
    render(
      <Provider>
        <FindCard
          view={view}
          seed="Row"
          focusRequest={1}
          seedOptions={{ caseSensitive: true, wholeWord: false, regexp: false }}
          takeFocus={false}
          onClose={onClose}
        />
      </Provider>
    );

    expect(field()).not.toHaveFocus();
    expect(screen.getByLabelText('Match case')).toHaveAttribute('aria-pressed', 'true');
    expect(getSearchQuery(view.state).caseSensitive).toBe(true);
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
  });
});
