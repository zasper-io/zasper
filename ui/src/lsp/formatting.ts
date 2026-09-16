import { ChangeDesc, ChangeSpec, Text } from '@codemirror/state';
import { LSPPlugin } from '@codemirror/lsp-client';
import { EditorView } from '@codemirror/view';

import { offsetAt, ProtocolPosition } from './positions';

/** One edit a server asks for: new text over a range of the document it was sent. */
export interface TextEdit {
  range: { start: ProtocolPosition; end: ProtocolPosition };
  newText: string;
}

/**
 * The changes that carry out a server's formatting edits.
 *
 * The edits are against the document the server was sent, so each range is read there and then carried
 * across whatever has been typed since — the same journey a diagnostic's range makes.
 */
export function formattingChanges(sent: Text, since: ChangeDesc, edits: TextEdit[]): ChangeSpec[] {
  return edits.map((edit) => {
    const from = since.mapPos(offsetAt(sent, edit.range.start), 1);
    const to = since.mapPos(offsetAt(sent, edit.range.end), -1);
    return { from: Math.min(from, to), to: Math.max(from, to), insert: edit.newText };
  });
}

export interface FormattingOptions {
  tabSize: number;
  insertSpaces: boolean;
}

/**
 * Asks the file's language server to format it, and applies what it answers.
 *
 * Resolves having done nothing when there is no server, or none that formats: format on save is a setting
 * of the editor's, and most files in a project have no server at all.
 */
export async function formatDocumentNow(
  view: EditorView,
  options: FormattingOptions
): Promise<void> {
  const plugin = LSPPlugin.get(view);
  if (plugin === null || !plugin.client.connected) {
    return;
  }
  await plugin.client.initializing;
  if (plugin.client.serverCapabilities?.documentFormattingProvider == null) {
    return;
  }
  plugin.client.sync();
  const sent = plugin.syncedDoc;
  const edits = await plugin.client.request<
    { textDocument: { uri: string }; options: { tabSize: number; insertSpaces: boolean } },
    TextEdit[] | null
  >('textDocument/formatting', {
    textDocument: { uri: plugin.uri },
    options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
  });
  if (edits === null || edits.length === 0) {
    return;
  }
  view.dispatch({ changes: formattingChanges(sent, plugin.unsyncedChanges.desc, edits) });
}
