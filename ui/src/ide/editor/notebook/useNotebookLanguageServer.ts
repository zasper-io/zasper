import { useEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { useAtomValue, useSetAtom } from 'jotai';

import { NotebookCell } from '@/api';
import { notebookLanguageFor } from '@/lsp/languages';
import { SourceCell } from '@/lsp/notebookDocument';
import { NotebookLanguageServer } from '@/lsp/notebookServer';
import { notebookServersAtom } from '@/store/languageServers';
import { projectDirAtom } from '@/store/serverInfo';

function codeCells(cells: NotebookCell[]): SourceCell[] {
  return cells.flatMap((cell, index) =>
    cell.cell_type === 'code' ? [{ id: cell.id, index, source: cell.source }] : []
  );
}

/**
 * The language server a notebook's code cells are given to, for as long as the notebook is open and its
 * kernel's language has one. Null while nothing serves it.
 */
export function useNotebookLanguageServer(options: {
  path: string;
  kernelLanguage: string | undefined;
  cells: NotebookCell[];
  loaded: boolean;
  viewFor: (cellId: string) => EditorView | null;
}): NotebookLanguageServer | null {
  const { path, kernelLanguage, cells, loaded, viewFor } = options;
  const root = useAtomValue(projectDirAtom);
  const setNotebookServers = useSetAtom(notebookServersAtom);
  const [server, setServer] = useState<NotebookLanguageServer | null>(null);
  const cellsNow = useRef(cells);
  cellsNow.current = cells;

  const target = loaded && root !== '' ? notebookLanguageFor(kernelLanguage) : null;
  const serverKey = target?.language.server;
  const extension = target?.extension;
  const languageId = target?.language.languageId;

  useEffect(() => {
    if (serverKey === undefined || extension === undefined || languageId === undefined) {
      return;
    }
    const opened = new NotebookLanguageServer(
      root,
      path,
      { server: serverKey, languageId },
      extension,
      serverKey === 'python',
      codeCells(cellsNow.current),
      viewFor
    );
    setServer(opened);
    setNotebookServers((all) => ({ ...all, [path]: serverKey }));
    return () => {
      opened.close();
      setServer(null);
      setNotebookServers((all) => {
        const rest = { ...all };
        delete rest[path];
        return rest;
      });
    };
  }, [root, path, serverKey, extension, languageId, viewFor, setNotebookServers]);

  useEffect(() => {
    server?.update(codeCells(cells));
  }, [server, cells]);

  return server;
}
