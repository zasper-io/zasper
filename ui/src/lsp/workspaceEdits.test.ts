import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyWorkspaceEdit, editReach, fileChanges } from './workspaceEdits';

const applyFileEdits = vi.fn();
vi.mock('@/api', () => ({ applyFileEdits: (files: unknown) => applyFileEdits(files) }));

const views = new Map<string, EditorView>();
vi.mock('./views', () => ({ editorViewFor: (path: string) => views.get(path) ?? null }));

const at = (line: number, character: number) => ({ line, character });
const edit = (from: [number, number], to: [number, number], newText: string) => ({
  range: { start: at(...from), end: at(...to) },
  newText,
});

const ROOT = '/work/rig';

beforeEach(() => {
  views.clear();
  applyFileEdits.mockReset();
  applyFileEdits.mockResolvedValue([]);
});

describe('fileChanges', () => {
  it('reads documentChanges into the project’s own paths', () => {
    const { changes, skipped } = fileChanges(ROOT, {
      documentChanges: [
        {
          textDocument: { uri: 'file:///work/rig/main.go', version: 2 },
          edits: [edit([0, 5], [0, 10], 'salute')],
        },
      ],
    });

    expect(skipped).toBe(0);
    expect(changes).toEqual([{ path: 'main.go', edits: [edit([0, 5], [0, 10], 'salute')] }]);
  });

  // A server that sends both means the same edit twice, and the protocol says documentChanges wins.
  it('ignores the changes map when documentChanges is there', () => {
    const { changes } = fileChanges(ROOT, {
      documentChanges: [
        { textDocument: { uri: 'file:///work/rig/a.go' }, edits: [edit([0, 0], [0, 1], 'x')] },
      ],
      changes: { 'file:///work/rig/b.go': [edit([0, 0], [0, 1], 'y')] },
    });

    expect(changes.map((change) => change.path)).toEqual(['a.go']);
  });

  it('reads the older changes map when that is all there is', () => {
    const { changes } = fileChanges(ROOT, {
      changes: { 'file:///work/rig/lib/b.go': [edit([1, 0], [1, 2], 'y')] },
    });

    expect(changes.map((change) => change.path)).toEqual(['lib/b.go']);
  });

  // Creating, renaming and deleting a file are in the same union and are not carried out.
  it('counts a change that is not an edit rather than acting on it', () => {
    const { changes, skipped } = fileChanges(ROOT, {
      documentChanges: [{ kind: 'create', textDocument: undefined }],
    });

    expect(changes).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('counts a file outside the project as outside', () => {
    const { changes, outside } = fileChanges(ROOT, {
      changes: { 'file:///elsewhere/x.go': [edit([0, 0], [0, 1], 'z')] },
    });

    expect(changes).toEqual([]);
    expect(outside).toBe(1);
  });
});

describe('editReach', () => {
  it('counts the edits, the files, and how many of them no editor holds', () => {
    views.set('main.go', new EditorView({ state: EditorState.create({ doc: 'x' }) }));

    const reach = editReach([
      { path: 'main.go', edits: [edit([0, 0], [0, 1], 'a'), edit([0, 1], [0, 2], 'b')] },
      { path: 'other.go', edits: [edit([0, 0], [0, 1], 'c')] },
    ]);

    expect(reach).toEqual({ edits: 3, files: 2, notOpen: 1 });
  });
});

describe('applyWorkspaceEdit', () => {
  it('edits a file with an editor in that editor, where it can be undone', async () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'func greet() {}\n' }),
    });
    views.set('main.go', view);

    const outcome = await applyWorkspaceEdit(ROOT, {
      changes: { 'file:///work/rig/main.go': [edit([0, 5], [0, 10], 'salute')] },
    });

    expect(view.state.doc.toString()).toBe('func salute() {}\n');
    expect(outcome.inEditors).toEqual(['main.go']);
    expect(applyFileEdits).not.toHaveBeenCalled();
  });

  it('writes a file with no editor on the server', async () => {
    applyFileEdits.mockResolvedValue([{ path: 'lib/b.go', applied: 1 }]);

    const outcome = await applyWorkspaceEdit(ROOT, {
      changes: { 'file:///work/rig/lib/b.go': [edit([2, 4], [2, 9], 'salute')] },
    });

    expect(applyFileEdits).toHaveBeenCalledWith([
      {
        path: 'lib/b.go',
        edits: [{ start: at(2, 4), end: at(2, 9), new_text: 'salute' }],
      },
    ]);
    expect(outcome.onDisk).toEqual(['lib/b.go']);
  });

  it('reports a file the server could not edit', async () => {
    applyFileEdits.mockResolvedValue([{ path: 'gone.go', error: 'no such file' }]);

    const outcome = await applyWorkspaceEdit(ROOT, {
      changes: { 'file:///work/rig/gone.go': [edit([0, 0], [0, 1], 'x')] },
    });

    expect(outcome.onDisk).toEqual([]);
    expect(outcome.failed).toEqual([{ path: 'gone.go', reason: 'no such file' }]);
  });

  // Two edits on one line, applied as one change set, so neither moves the other.
  it('applies every edit for one editor in a single change', async () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'x = one + one\n' }) });
    views.set('a.go', view);

    await applyWorkspaceEdit(ROOT, {
      changes: {
        'file:///work/rig/a.go': [edit([0, 4], [0, 7], 'first'), edit([0, 10], [0, 13], 'second')],
      },
    });

    expect(view.state.doc.toString()).toBe('x = first + second\n');
  });
});
