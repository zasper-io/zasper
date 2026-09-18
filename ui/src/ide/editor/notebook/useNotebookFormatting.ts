import { MutableRefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { useAtomValue } from 'jotai';
import { toast } from 'react-toastify';

import { NotebookModel } from '@/api';
import { NotebookLanguageServer } from '@/lsp/notebookServer';
import { serverStatusAtom } from '@/store/languageServers';
import type { EditorSettings } from '@/api';

/** Format Cell and Format Notebook, through the notebook's language server. */
export function useNotebookFormatting(options: {
  languageServer: NotebookLanguageServer | null;
  notebook: NotebookModel;
  focusedIndex: number;
  cellViews: MutableRefObject<Map<string, EditorView>>;
  settings: EditorSettings;
}) {
  const { languageServer, notebook, focusedIndex, cellViews, settings } = options;
  const serverStatuses = useAtomValue(serverStatusAtom);

  return async (scope: 'cell' | 'notebook') => {
    const server = languageServer;
    if (server === null) {
      return;
    }
    const focused = notebook.cells[focusedIndex];
    const targets =
      scope === 'cell'
        ? focused?.cell_type === 'code'
          ? [focused]
          : []
        : notebook.cells.filter((cell) => cell.cell_type === 'code');
    const formatting = { tabSize: settings.tab_size, insertSpaces: !settings.indent_with_tabs };
    for (const cell of targets) {
      const view = cellViews.current.get(cell.id);
      if (view === undefined) {
        continue;
      }
      if (!(await server.formatCell(cell.id, view, formatting))) {
        const name = serverStatuses[server.server]?.name || 'The language server';
        toast.warning(
          `${name} does not format code. A server that does, such as ruff server, can be set in Settings → Language servers.`
        );
        return;
      }
    }
  };
}
