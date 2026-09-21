import { LSPPlugin } from '@codemirror/lsp-client';
import { EditorView } from '@codemirror/view';

import { getFileContent } from '@/api';
import { ReferenceFile, ReferencePlace } from '@/store/references';
import { readyServerFor } from './servers';
import { ProtocolRange } from './workspaceEdits';
import { pathOfUri } from './languages';
import { editorViewFor } from './views';

/** How many files are read from disk to put the line's text on a row. */
const MAX_FILES_READ = 40;

interface Location {
  uri: string;
  range: ProtocolRange;
}

/** A server may answer with locations, or with links whose target range is the one that matters. */
interface LocationLink {
  targetUri: string;
  targetSelectionRange?: ProtocolRange;
  targetRange?: ProtocolRange;
}

function locationsOf(answer: unknown): Location[] {
  if (answer === null || answer === undefined) {
    return [];
  }
  const list = Array.isArray(answer) ? answer : [answer];
  return list.flatMap((item) => {
    const link = item as Location & LocationLink;
    if (typeof link.uri === 'string') {
      return [{ uri: link.uri, range: link.range }];
    }
    if (typeof link.targetUri === 'string') {
      const range = link.targetSelectionRange ?? link.targetRange;
      return range === undefined ? [] : [{ uri: link.targetUri, range }];
    }
    return [];
  });
}

/** The word under the cursor, which is what the panel's heading names. */
export function symbolAt(view: EditorView): string {
  const cursor = view.state.selection.main;
  if (!cursor.empty) {
    return view.state.sliceDoc(cursor.from, cursor.to).trim();
  }
  const line = view.state.doc.lineAt(cursor.head);
  const column = cursor.head - line.from;
  const before = /[\p{L}\p{N}_$]*$/u.exec(line.text.slice(0, column))?.[0] ?? '';
  const after = /^[\p{L}\p{N}_$]*/u.exec(line.text.slice(column))?.[0] ?? '';
  return `${before}${after}`;
}

/** The text of the lines a file's references fall on, from its editor when it has one. */
async function linesOf(path: string, wanted: Set<number>): Promise<Map<number, string>> {
  const view = editorViewFor(path);
  const text = new Map<number, string>();
  if (view !== null) {
    const doc = view.state.doc;
    wanted.forEach((line) => {
      if (line + 1 <= doc.lines) {
        text.set(line, doc.line(line + 1).text);
      }
    });
    return text;
  }
  try {
    const file = await getFileContent(path);
    if (file.format !== 'text') {
      return text;
    }
    const lines = file.content.split('\n');
    wanted.forEach((line) => {
      if (line < lines.length) {
        text.set(line, lines[line].replace(/\r$/, ''));
      }
    });
  } catch {
    // A file that cannot be read still has rows; they say where, without the line.
  }
  return text;
}

/**
 * Every place a name is used, for the panel under the editor.
 *
 * The definition is asked for separately and marked, rather than being a list of its own: it is one of
 * the places, and the row says which one it is. Null when the file's server cannot answer — no server for
 * the language, or not ready — which is the same silence go to definition keeps.
 */
export async function findReferences(
  path: string,
  fileName: string,
  view: EditorView,
  /** False for a count alone — a rename's reach — where no line has to be read from disk. */
  withText = true
): Promise<{ files: ReferenceFile[]; total: number } | null> {
  const ready = readyServerFor(fileName);
  const plugin = LSPPlugin.get(view);
  if (ready === null || plugin === null) {
    return null;
  }
  ready.client.sync();
  const position = plugin.toPosition(view.state.selection.main.head);
  const document = { textDocument: { uri: plugin.uri }, position };

  const [references, definitions] = await Promise.all([
    ready.client.request<unknown, unknown>('textDocument/references', {
      ...document,
      context: { includeDeclaration: true },
    }),
    ready.client
      .request<unknown, unknown>('textDocument/definition', document)
      .catch(() => null as unknown),
  ]);

  const defined = new Set(
    locationsOf(definitions).map((item) => `${item.uri}:${item.range.start.line}`)
  );
  const byPath = new Map<string, ReferencePlace[]>();
  locationsOf(references).forEach((item) => {
    const where = pathOfUri(ready.root, item.uri);
    if (where === null) {
      return;
    }
    byPath.set(where, [
      ...(byPath.get(where) ?? []),
      {
        line: item.range.start.line,
        character: item.range.start.character,
        endCharacter:
          item.range.end.line === item.range.start.line
            ? item.range.end.character
            : item.range.start.character,
        text: '',
        definition: defined.has(`${item.uri}:${item.range.start.line}`),
      },
    ]);
  });

  const paths = [...byPath.keys()].sort((left, right) => left.localeCompare(right));
  const files = await Promise.all(
    paths.map(async (each, index) => {
      const places = (byPath.get(each) ?? []).sort(
        (left, right) => left.line - right.line || left.character - right.character
      );
      const text =
        withText && index < MAX_FILES_READ
          ? await linesOf(each, new Set(places.map((place) => place.line)))
          : new Map<number, string>();
      return {
        path: each,
        places: places.map((place) => ({ ...place, text: text.get(place.line) ?? '' })),
      };
    })
  );

  return { files, total: files.reduce((count, file) => count + file.places.length, 0) };
}
