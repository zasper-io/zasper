import { LSPPlugin } from '@codemirror/lsp-client';
import { EditorView } from '@codemirror/view';

import { findReferences } from './references';
import { editorViewFor } from './views';
import { readyServerFor } from './servers';
import { applyWorkspaceEdit, EditOutcome, ProtocolWorkspaceEdit } from './workspaceEdits';

/** What a rename would come to, which is what the field says before it is applied. */
export interface RenameReach {
  uses: number;
  files: number;
  /** Files with no editor: the ones a `⌘Z` will not reach, because they are written on disk. */
  notOpen: number;
}

/**
 * Whether the server will rename what the cursor is on, and what it calls it now.
 *
 * `prepareRename` is optional in the protocol, so a server that does not answer it is taken at its word
 * later — the rename request itself will refuse if it cannot. Null means only that nothing is known here.
 */
export async function canRename(fileName: string, view: EditorView): Promise<boolean | null> {
  const ready = readyServerFor(fileName);
  const plugin = LSPPlugin.get(view);
  if (ready === null || plugin === null) {
    return false;
  }
  if (ready.client.serverCapabilities?.renameProvider === undefined) {
    return false;
  }
  if (
    typeof ready.client.serverCapabilities.renameProvider === 'boolean' ||
    ready.client.serverCapabilities.renameProvider.prepareProvider !== true
  ) {
    return null;
  }
  ready.client.sync();
  try {
    const answer = await ready.client.request<unknown, unknown>('textDocument/prepareRename', {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(view.state.selection.main.head),
    });
    return answer !== null && answer !== undefined;
  } catch {
    return false;
  }
}

/**
 * How far a rename would reach, counted from the places the name is used.
 *
 * The count cannot come from the rename itself: a server answers `textDocument/rename` with the edit for
 * one new name, and the field has to say how many places there are before anything is typed into it.
 * References are the same set of places, which is what makes them the honest count to show.
 */
export async function renameReach(
  path: string,
  fileName: string,
  view: EditorView
): Promise<RenameReach | null> {
  const found = await findReferences(path, fileName, view, false);
  if (found === null) {
    return null;
  }
  return {
    uses: found.total,
    files: found.files.length,
    notOpen: found.files.filter((file) => editorViewFor(file.path) === null).length,
  };
}

/** Renames what the cursor is on, everywhere the server says the name is. */
export async function renameSymbol(
  fileName: string,
  view: EditorView,
  newName: string
): Promise<EditOutcome> {
  const ready = readyServerFor(fileName);
  const plugin = LSPPlugin.get(view);
  if (ready === null || plugin === null) {
    throw new Error('No language server is running for this file.');
  }
  ready.client.sync();
  const edit = await ready.client.request<unknown, ProtocolWorkspaceEdit | null>(
    'textDocument/rename',
    {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(view.state.selection.main.head),
      newName,
    }
  );
  if (edit === null || edit === undefined) {
    throw new Error('The server had nothing to change.');
  }
  return applyWorkspaceEdit(ready.root, edit);
}
