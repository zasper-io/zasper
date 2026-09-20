import { useEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { useAtomValue, useSetAtom } from 'jotai';

import { NotebookCell } from '@/api';
import { notebookLanguageFor } from '@/lsp/languages';
import { setServerInterpreter } from '@/lsp/servers';
import { SourceCell } from '@/lsp/notebookDocument';
import { NotebookLanguageServer } from '@/lsp/notebookServer';
import { notebookServersAtom, serverInterpretersAtom } from '@/store/languageServers';
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
  /** The Python the notebook's kernel runs, so the server resolves the imports the cells actually use. */
  interpreter: string | undefined;
  cells: NotebookCell[];
  loaded: boolean;
  viewFor: (cellId: string) => EditorView | null;
}): NotebookLanguageServer | null {
  const { path, kernelLanguage, interpreter, cells, loaded, viewFor } = options;
  const root = useAtomValue(projectDirAtom);
  const setNotebookServers = useSetAtom(notebookServersAtom);
  const setServerInterpreters = useSetAtom(serverInterpretersAtom);
  const [server, setServer] = useState<NotebookLanguageServer | null>(null);
  const cellsNow = useRef(cells);
  cellsNow.current = cells;

  const target = loaded && root !== '' ? notebookLanguageFor(kernelLanguage) : null;
  const serverKey = target?.language.server;
  const extension = target?.extension;
  const languageId = target?.language.languageId;

  // Before the server is started, where it can be: a server already running is told its settings changed.
  useEffect(() => {
    if (serverKey === undefined) {
      return;
    }
    setServerInterpreter(serverKey, interpreter);
    setServerInterpreters((all) => ({ ...all, [serverKey]: interpreter ?? '' }));
  }, [serverKey, interpreter, setServerInterpreters]);

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
