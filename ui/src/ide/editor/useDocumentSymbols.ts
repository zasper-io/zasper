import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';

import { DocumentSymbol, documentSymbols, symbolTrail } from '@/lsp/symbols';

/** How long after the typing stops the file's symbols are asked for again. */
const ASK_DELAY = 700;

/**
 * What the file in front declares, and which of those the cursor is inside — the breadcrumb bar's last
 * crumbs (story 20).
 *
 * The trail is state and the cursor is not: the editor deliberately does not render on a keystroke, so
 * the line is compared against the trail that is already drawn and only a *different* trail renders.
 */
export function useDocumentSymbols(options: {
  name: string;
  view: () => EditorView | null;
  /** False for a file no language server serves, which asks for nothing. */
  served: boolean;
  /** Bumped when the file is read and when its editor is created. */
  readCount: number;
  viewCount: number;
}) {
  const { name, served, readCount, viewCount } = options;
  const view = options.view;
  const [symbols, setSymbols] = useState<DocumentSymbol[]>([]);
  const [trail, setTrail] = useState<DocumentSymbol[]>([]);
  const symbolsRef = useRef<DocumentSymbol[]>([]);
  const trailRef = useRef<DocumentSymbol[]>([]);
  const askTimer = useRef<number>();

  const place = useCallback((line: number) => {
    const next = symbolTrail(symbolsRef.current, line - 1);
    const same =
      next.length === trailRef.current.length &&
      next.every((symbol, index) => symbol.name === trailRef.current[index]?.name);
    if (!same) {
      trailRef.current = next;
      setTrail(next);
    }
  }, []);

  const ask = useCallback(() => {
    const editor = view();
    if (!served || editor === null) {
      return;
    }
    void documentSymbols(name, editor)
      .then((found) => {
        symbolsRef.current = found;
        setSymbols(found);
        const current = view();
        if (current !== null) {
          place(current.state.doc.lineAt(current.state.selection.main.head).number);
        }
      })
      .catch(() => {
        // A server that cannot say leaves the bar as the path alone.
      });
  }, [name, place, served, view]);

  // Asked once the file is read and its editor exists — and again a moment after it stops changing.
  useEffect(() => {
    if (!served || readCount === 0 || viewCount === 0) {
      return;
    }
    const first = window.setTimeout(ask, ASK_DELAY);
    return () => window.clearTimeout(first);
  }, [ask, served, readCount, viewCount]);

  useEffect(() => () => window.clearTimeout(askTimer.current), []);

  /** Called from the editor's own update, which is the only place the cursor's line is known cheaply. */
  const onCursor = useCallback(
    (line: number, changed: boolean) => {
      place(line);
      if (changed) {
        window.clearTimeout(askTimer.current);
        askTimer.current = window.setTimeout(ask, ASK_DELAY);
      }
    },
    [ask, place]
  );

  return { symbols, trail, onCursor };
}
