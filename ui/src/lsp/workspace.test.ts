import { LSPClient } from '@codemirror/lsp-client';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

import { ZasperWorkspace } from './workspace';

function fakeClient() {
  return { didOpen: vi.fn(), didClose: vi.fn() } as unknown as LSPClient & {
    didOpen: ReturnType<typeof vi.fn>;
    didClose: ReturnType<typeof vi.fn>;
  };
}

const view = (doc: string) => ({ state: EditorState.create({ doc }) }) as unknown as EditorView;

function workspace() {
  const client = fakeClient();
  const hooks = { opened: vi.fn(), emptied: vi.fn(), display: vi.fn() };
  return { workspace: new ZasperWorkspace(client, hooks), client, hooks };
}

describe('ZasperWorkspace', () => {
  it('opens a file with the server, and says the server is wanted', () => {
    const { workspace: files, client, hooks } = workspace();

    files.openFile('file:///p/main.go', 'go', view('package main'));

    expect(client.didOpen).toHaveBeenCalledTimes(1);
    expect(files.files[0].version).toBe(0);
    // With the file's URI, which is how the server's already-published problems reach the new editor.
    expect(hooks.opened).toHaveBeenCalledWith('file:///p/main.go');
  });

  // The file editor makes a new editor every time it reads the file.
  it('takes a new editor for an open file as the file closed and opened again, at a new version', () => {
    const { workspace: files, client } = workspace();
    files.openFile('file:///p/main.go', 'go', view('a'));

    files.openFile('file:///p/main.go', 'go', view('b'));

    expect(client.didClose).toHaveBeenCalledWith('file:///p/main.go');
    expect(files.files).toHaveLength(1);
    expect(files.files[0].version).toBe(1);
    expect(files.files[0].doc.toString()).toBe('b');
  });

  it('ignores a close from an editor that no longer holds the file, and says when the last one goes', () => {
    const { workspace: files, client, hooks } = workspace();
    const first = view('a');
    files.openFile('file:///p/main.go', 'go', first);
    const second = view('b');
    files.openFile('file:///p/main.go', 'go', second);
    client.didClose.mockClear();

    files.closeFile('file:///p/main.go', first);
    expect(client.didClose).not.toHaveBeenCalled();

    files.closeFile('file:///p/main.go', second);
    expect(client.didClose).toHaveBeenCalledWith('file:///p/main.go');
    expect(hooks.emptied).toHaveBeenCalled();
  });

  it('asks the app to show a file another file jumps into', async () => {
    const { workspace: files, hooks } = workspace();
    hooks.display.mockResolvedValue(null);

    await files.displayFile('file:///p/helper.go');

    expect(hooks.display).toHaveBeenCalledWith('file:///p/helper.go');
  });
});
