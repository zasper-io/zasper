import { LSPPlugin } from '@codemirror/lsp-client';
import { EditorView } from '@codemirror/view';

import { pathOfUri } from './languages';
import { readyServerFor, readyServers } from './servers';
import { ProtocolRange } from './workspaceEdits';

/** One thing a file declares: a name, what kind of thing it is, and where it is. */
export interface DocumentSymbol {
  name: string;
  kind: number;
  /** A signature or a type, as the server words it. */
  detail?: string;
  line: number;
  character: number;
  /** The last line the symbol covers, which is how the trail knows what the cursor is inside. */
  endLine: number;
  children: DocumentSymbol[];
}

/** A symbol found by name anywhere in the project, which is what the palette's `#` lists. */
export interface ProjectSymbol {
  path: string;
  name: string;
  kind: number;
  container?: string;
  line: number;
  character: number;
}

interface ServerSymbol {
  name: string;
  kind: number;
  detail?: string;
  range?: ProtocolRange;
  selectionRange?: ProtocolRange;
  children?: ServerSymbol[];
  /** The flat answer's shape, which older servers still send. */
  location?: { uri: string; range: ProtocolRange };
  containerName?: string;
}

/*
The glyph for a kind, from the protocol's SymbolKind numbers.

Three shapes rather than twenty-six: something that runs, something with parts, and something that holds a
value. A list of symbols is read by name — the glyph is there to break the column up, and twenty-six of
them would be a legend to learn.
*/
const RUNS = new Set([6, 9, 12, 24, 25]);
const HAS_PARTS = new Set([2, 3, 4, 5, 10, 11, 19, 23, 26]);

export function kindGlyph(kind: number): string {
  if (RUNS.has(kind)) {
    return 'ƒ';
  }
  if (HAS_PARTS.has(kind)) {
    return '◇';
  }
  return '•';
}

function symbolsOf(answer: ServerSymbol[] | null | undefined): DocumentSymbol[] {
  return (answer ?? []).map((item) => {
    const range = item.range ?? item.location?.range;
    const at = item.selectionRange ?? range;
    return {
      name: item.name,
      kind: item.kind,
      detail: item.detail,
      line: at?.start.line ?? 0,
      character: at?.start.character ?? 0,
      endLine: range?.end.line ?? at?.end.line ?? 0,
      children: symbolsOf(item.children),
    };
  });
}

/** What a file declares, as its server sees it. Empty when no server serves it, or it cannot say. */
export async function documentSymbols(
  fileName: string,
  view: EditorView
): Promise<DocumentSymbol[]> {
  const ready = readyServerFor(fileName);
  const plugin = LSPPlugin.get(view);
  if (ready === null || plugin === null) {
    return [];
  }
  if (ready.client.serverCapabilities?.documentSymbolProvider == null) {
    return [];
  }
  ready.client.sync();
  const answer = await ready.client.request<unknown, ServerSymbol[] | null>(
    'textDocument/documentSymbol',
    { textDocument: { uri: plugin.uri } }
  );
  return symbolsOf(answer);
}

/**
 * The symbols a line is inside, outermost first — which is what the breadcrumb bar carries.
 *
 * A flat answer has no nesting to follow, so the trail is one symbol deep; a hierarchical one is followed
 * as far as it goes. A line inside nothing has no trail, which is what a file's imports look like.
 */
export function symbolTrail(symbols: DocumentSymbol[], line: number): DocumentSymbol[] {
  const holding = symbols.find((symbol) => line >= symbol.line && line <= symbol.endLine);
  if (holding === undefined) {
    return [];
  }
  return [holding, ...symbolTrail(holding.children, line)];
}

/** The symbols at the same level as the last of a trail, for that crumb's own menu. */
export function symbolSiblings(
  symbols: DocumentSymbol[],
  trail: DocumentSymbol[],
  depth: number
): DocumentSymbol[] {
  return depth === 0 ? symbols : (trail[depth - 1]?.children ?? []);
}

/**
 * A name asked of every running server at once, which is how a symbol in a file that has never been
 * opened is found. A server that refuses the question is left out of the answer.
 */
export async function workspaceSymbols(query: string): Promise<ProjectSymbol[]> {
  if (query === '') {
    return [];
  }
  const answers = await Promise.all(
    readyServers()
      .filter((ready) => ready.client.serverCapabilities?.workspaceSymbolProvider != null)
      .map(async (ready) => {
        try {
          const found = await ready.client.request<unknown, ServerSymbol[] | null>(
            'workspace/symbol',
            { query }
          );
          return (found ?? []).flatMap((item): ProjectSymbol[] => {
            const uri = item.location?.uri;
            const path = uri === undefined ? null : pathOfUri(ready.root, uri);
            if (path === null || item.location === undefined) {
              return [];
            }
            return [
              {
                path,
                name: item.name,
                kind: item.kind,
                container: item.containerName,
                line: item.location.range.start.line,
                character: item.location.range.start.character,
              },
            ];
          });
        } catch {
          return [];
        }
      })
  );
  return answers.flat();
}
