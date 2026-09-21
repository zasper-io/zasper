import { useEffect, useMemo, useRef, useState } from 'react';

import { debounce } from 'lodash';

import { documentSymbols, DocumentSymbol, workspaceSymbols } from '@/lsp/symbols';
import { editorViewFor } from '@/lsp/views';
import { baseName } from '@/paths';

/** One row of a symbol search: where to go, and what to read on the row. */
export interface SymbolMatch {
  path: string;
  name: string;
  /** A signature, or what the symbol belongs to. */
  detail?: string;
  kind: number;
  line: number;
  character: number;
}

/** A tree of symbols as one list, each row carrying what it sits inside. */
function flatten(symbols: DocumentSymbol[], path: string, inside: string): SymbolMatch[] {
  return symbols.flatMap((symbol) => [
    {
      path,
      name: symbol.name,
      detail: symbol.detail === undefined || symbol.detail === '' ? inside : symbol.detail,
      kind: symbol.kind,
      line: symbol.line,
      character: symbol.character,
    },
    ...flatten(symbol.children, path, symbol.name),
  ]);
}

function matching(rows: SymbolMatch[], needle: string): SymbolMatch[] {
  return needle === ''
    ? rows
    : rows.filter((row) => row.name.toLowerCase().includes(needle.toLowerCase()));
}

/**
 * The symbols a palette query is asking for: `@` the file in front, `#` the whole project.
 *
 * The file's own symbols are filtered here, because the server answered with all of them at once and
 * filtering a list already in hand on every keystroke is free. The project's are the server's own
 * search — a name in a file that has never been opened is exactly what it is for — so that one is
 * debounced and a late answer to an abandoned query is dropped.
 */
export function useSymbolMatches(
  mode: 'file' | 'project' | null,
  query: string,
  activePath: string
): SymbolMatch[] {
  const [inFile, setInFile] = useState<SymbolMatch[]>([]);
  const [inProject, setInProject] = useState<SymbolMatch[]>([]);
  const wanted = useRef<string>('');

  useEffect(() => {
    if (mode !== 'file' || activePath === '') {
      setInFile([]);
      return;
    }
    const view = editorViewFor(activePath);
    if (view === null) {
      setInFile([]);
      return;
    }
    let live = true;
    void documentSymbols(baseName(activePath), view)
      .then((found) => {
        if (live) {
          setInFile(flatten(found, activePath, ''));
        }
      })
      .catch(() => setInFile([]));
    return () => {
      live = false;
    };
  }, [mode, activePath]);

  const search = useMemo(
    () =>
      debounce(async (needle: string) => {
        wanted.current = needle;
        try {
          const found = await workspaceSymbols(needle);
          if (wanted.current === needle) {
            setInProject(
              found.map((symbol) => ({
                path: symbol.path,
                name: symbol.name,
                detail: [symbol.container, baseName(symbol.path)].filter(Boolean).join(' · '),
                kind: symbol.kind,
                line: symbol.line,
                character: symbol.character,
              }))
            );
          }
        } catch {
          // Every server was asked; one that cannot answer leaves the list as it is.
        }
      }, 150),
    []
  );

  useEffect(() => {
    if (mode !== 'project' || query === '') {
      search.cancel();
      wanted.current = '';
      setInProject([]);
      return;
    }
    void search(query);
  }, [mode, query, search]);

  useEffect(() => () => search.cancel(), [search]);

  if (mode === 'file') {
    return matching(inFile, query);
  }
  return mode === 'project' ? inProject : [];
}
