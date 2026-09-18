import { Completion, CompletionContext, CompletionResult, snippet } from '@codemirror/autocomplete';
import { Diagnostic, setDiagnostics } from '@codemirror/lint';
import { LSPClient } from '@codemirror/lsp-client';
import { ChangeSet, Text } from '@codemirror/state';
import { EditorView, Tooltip } from '@codemirror/view';
import { marked } from 'marked';

import { changeBetween } from '@/ide/editor/textChange';
import { Problem, Severity } from '@/store/languageServers';
import { applyTextEdits, TextEdit } from './formatting';
import { fileUri, ServerLanguage } from './languages';
import {
  buildVirtualDocument,
  fromVirtual,
  maskIPython,
  SourceCell,
  toVirtual,
  VirtualDocument,
} from './notebookDocument';
import { offsetAt, ProtocolPosition } from './positions';
import { sanitizeHtml } from './sanitize';
import { attachNotebook, isServerReady, PublishedDiagnostic } from './servers';
import { NotebookFile, ZasperWorkspace } from './workspace';

const SEVERITIES: Severity[] = ['error', 'warning', 'info', 'hint'];

/** How long typing has to pause before the server is sent the notebook, and so answers with problems. */
const SYNC_DELAY = 400;

/** A diagnostic in a cell's own lines, against the source the server was sent. */
interface CellDiagnostic {
  from: ProtocolPosition;
  to: ProtocolPosition;
  severity: Severity;
  message: string;
  source?: string;
}

/**
 * Pyright's and basedpyright's words for a value left unused, which on a cell's last line is how a notebook
 * shows it — so there it is not a problem at all.
 */
const SHOWN_VALUE_CODES = new Set(['reportUnusedExpression', 'reportUnusedCallResult']);

/** CompletionItemKind, from the protocol's numbering, to the kinds CodeMirror draws an icon for. */
const COMPLETION_KINDS: Record<number, string> = {
  1: 'text',
  2: 'method',
  3: 'function',
  4: 'class',
  5: 'property',
  6: 'variable',
  7: 'class',
  8: 'interface',
  9: 'namespace',
  10: 'property',
  12: 'constant',
  13: 'enum',
  14: 'keyword',
  20: 'constant',
  21: 'constant',
  22: 'class',
  25: 'type',
};

type MarkupContent = { kind: string; value: string };
type MarkedString = string | { language: string; value: string };

interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | MarkupContent;
  sortText?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: { newText: string };
  additionalTextEdits?: unknown[];
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function markupToHtml(value: MarkupContent | MarkedString): string {
  if (typeof value === 'string') {
    return marked.parse(value, { async: false });
  }
  if ('language' in value) {
    return `<pre><code>${escapeHtml(value.value)}</code></pre>`;
  }
  return value.kind === 'markdown'
    ? marked.parse(value.value, { async: false })
    : `<pre>${escapeHtml(value.value)}</pre>`;
}

export function documentationElement(html: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'cm-lsp-documentation';
  element.innerHTML = sanitizeHtml(html);
  return element;
}

/** An LSP snippet as `@codemirror/autocomplete` writes one: `$1` is `${1}`, and `\$` is a dollar. */
function toSnippet(text: string): string {
  return text.replace(/\\([$}\\])|\$(\d+)/g, (_match, escaped, field) => escaped ?? `\${${field}}`);
}

function positionIn(doc: Text, offset: number): ProtocolPosition {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

/**
 * One notebook's cells, given to the language server of its kernel's language as a single document
 * (`notebookDocument.ts`): kept in step with the cells, asked about a place in one of them, and its
 * problems drawn back in the cell each is about.
 */
export class NotebookLanguageServer {
  private readonly client: LSPClient;
  private readonly workspace: ZasperWorkspace;
  private readonly file: NotebookFile;
  private readonly detach: () => void;
  private readonly uri: string;
  private cells: SourceCell[];
  private syncTimer: number | undefined;
  /** What the server last said about each cell, to draw again in an editor that arrives later. */
  private known = new Map<string, { source: string; list: CellDiagnostic[] }>();

  constructor(
    private readonly root: string,
    private readonly path: string,
    private readonly language: ServerLanguage,
    private readonly extension: string,
    private readonly ipython: boolean,
    cells: SourceCell[],
    private readonly viewFor: (cellId: string) => EditorView | null
  ) {
    this.cells = cells;
    this.uri = fileUri(root, `${path}.${extension}`);
    const attached = attachNotebook(root, language, this.uri, {
      path,
      diagnostics: (published, server) => this.receive(published, server),
    });
    this.client = attached.client;
    this.workspace = attached.workspace;
    this.detach = attached.detach;
    const layout = buildVirtualDocument(cells, ipython);
    this.file = this.workspace.openNotebook(this.uri, language.languageId, layout.text, layout);
  }

  get server(): string {
    return this.language.server;
  }

  close(): void {
    window.clearTimeout(this.syncTimer);
    this.workspace.closeNotebook(this.file);
    this.detach();
    this.known.forEach((_known, cellId) => this.clearCell(cellId));
    this.known.clear();
  }

  /** The notebook's code cells as they now are. */
  update(cells: SourceCell[]): void {
    this.cells = cells;
    this.stage();
    window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      if (this.ready()) {
        this.client.sync();
      }
    }, SYNC_DELAY);
  }

  private stage(): void {
    const layout = buildVirtualDocument(this.cells, this.ipython);
    this.file.pending = { doc: Text.of(layout.text.split('\n')), layout };
  }

  private ready(): boolean {
    return isServerReady(this.language.server) && this.client.connected;
  }

  /**
   * Where `offset` in a cell's editor is in the virtual document, once the server has that editor's text.
   * The cell's own view is newer than `cells`, which arrives a render later.
   */
  private locate(cellId: string, view: EditorView, offset: number): ProtocolPosition | null {
    if (!this.ready()) {
      return null;
    }
    const source = view.state.doc.toString();
    if (this.cells.some((cell) => cell.id === cellId && cell.source !== source)) {
      this.cells = this.cells.map((cell) => (cell.id === cellId ? { ...cell, source } : cell));
      this.stage();
    }
    this.client.sync();
    return toVirtual(this.file.layout, cellId, positionIn(view.state.doc, offset));
  }

  async hover(cellId: string, view: EditorView, offset: number): Promise<Tooltip | null> {
    const position = this.locate(cellId, view, offset);
    if (position === null || !this.client.serverCapabilities?.hoverProvider) {
      return null;
    }
    const result = await this.client.request<
      unknown,
      { contents: MarkupContent | MarkedString | MarkedString[] } | null
    >('textDocument/hover', { textDocument: { uri: this.uri }, position });
    if (result == null) {
      return null;
    }
    const parts = Array.isArray(result.contents) ? result.contents : [result.contents];
    const html = parts.map(markupToHtml).join('');
    if (html.trim() === '') {
      return null;
    }
    const word = view.state.wordAt(offset);
    return {
      pos: word?.from ?? offset,
      end: word?.to ?? offset,
      above: true,
      create: () => ({ dom: documentationElement(html) }),
    };
  }

  async complete(cellId: string, context: CompletionContext): Promise<CompletionResult | null> {
    const position = this.locate(cellId, context.view!, context.pos);
    if (position === null || !this.client.serverCapabilities?.completionProvider) {
      return null;
    }
    const result = await this.client.request<
      unknown,
      CompletionItem[] | { isIncomplete: boolean; items: CompletionItem[] } | null
    >('textDocument/completion', {
      textDocument: { uri: this.uri },
      position,
      context: { triggerKind: 1 },
    });
    if (result == null) {
      return null;
    }
    // An item that also edits elsewhere — an auto-import, at the top of the joined document — would
    // insert a name without what makes it work.
    const items = (Array.isArray(result) ? result : result.items).filter(
      (item) => (item.additionalTextEdits?.length ?? 0) === 0
    );
    if (items.length === 0) {
      return null;
    }
    const word = context.matchBefore(/\w*$/);
    const options = [...items]
      .sort((left, right) =>
        (left.sortText ?? left.label).localeCompare(right.sortText ?? right.label)
      )
      .map((item, rank): Completion => {
        const text = item.textEdit?.newText ?? item.insertText ?? item.label;
        const documentation = item.documentation;
        return {
          label: item.label,
          type: item.kind === undefined ? undefined : COMPLETION_KINDS[item.kind],
          detail: item.detail,
          // The server's order, where CodeMirror's fuzzy score does not already decide.
          boost: -Math.min(rank, 99),
          apply: item.insertTextFormat === 2 ? snippet(toSnippet(text)) : text,
          info:
            documentation === undefined || documentation === ''
              ? undefined
              : () => documentationElement(markupToHtml(documentation)),
        };
      });
    return {
      from: word?.from ?? context.pos,
      options,
      validFor: !Array.isArray(result) && result.isIncomplete ? undefined : /^\w*$/,
    };
  }

  /**
   * Formats one cell: the server is given the cell alone, as a document of its own, because a formatter's
   * edits to the whole notebook would reach across the gaps between cells. IPython's lines go to it as
   * comments and are put back afterwards; a cell the kernel reads as another language is left alone.
   * Resolves false when there is nothing that formats, true once the cell is done.
   */
  async formatCell(
    cellId: string,
    view: EditorView,
    options: { tabSize: number; insertSpaces: boolean }
  ): Promise<boolean> {
    if (!this.ready()) {
      return false;
    }
    await this.client.initializing;
    if (this.client.serverCapabilities?.documentFormattingProvider == null) {
      return false;
    }
    const source = view.state.doc.toString();
    const originals = source.split('\n');
    const marker = (line: number) => `# zasper-hidden-${line}`;
    const masked = this.ipython
      ? maskIPython(source, marker)
      : { text: source, hidden: new Set<number>() };
    if (masked.hidden.size === originals.length) {
      return true;
    }

    const uri = fileUri(this.root, `${this.path}.format.${this.extension}`);
    const scratch = attachNotebook(this.root, this.language, uri, {
      path: `${this.path}.format`,
      diagnostics: () => [],
    });
    const doc = Text.of(masked.text.split('\n'));
    this.client.didOpen({
      uri,
      languageId: this.language.languageId,
      version: 0,
      doc,
      getView: () => null,
    });
    let edits: TextEdit[] | null;
    try {
      edits = await this.client.request<unknown, TextEdit[] | null>('textDocument/formatting', {
        textDocument: { uri },
        options,
      });
    } finally {
      this.client.didClose(uri);
      scratch.detach();
    }
    if (edits == null || edits.length === 0) {
      return true;
    }

    let formatted = applyTextEdits(doc, edits).toString();
    if (!source.endsWith('\n')) {
      formatted = formatted.replace(/\n+$/, '');
    }
    const restored = formatted.split('\n').map((line) => {
      const found = /^(\s*)# zasper-hidden-(\d+)$/.exec(line);
      if (found === null) {
        return line;
      }
      const original = originals[Number(found[2])];
      return `${found[1]}${original.trimStart()}`;
    });
    const text = restored.join('\n');
    // A formatter that lost or merged one of IPython's lines has changed what the cell does.
    const kept = [...masked.hidden].every((line) =>
      restored.some((each) => each.trimStart() === originals[line].trimStart())
    );
    if (!kept || view.state.doc.toString() !== source || text === source) {
      return true;
    }
    view.dispatch({ changes: changeBetween(source, text), userEvent: 'format' });
    return true;
  }

  /** The server's diagnostics for the virtual document, drawn in each cell and returned as problems. */
  private receive(published: PublishedDiagnostic[], server: string): Problem[] {
    const layout = this.file.layout;
    const byCell = new Map<string, CellDiagnostic[]>();
    const problems: Problem[] = [];
    published.forEach((item) => {
      const start = fromVirtual(layout, item.range.start);
      if (start === null) {
        return;
      }
      const code = item.code === undefined ? undefined : String(item.code);
      if (code !== undefined && SHOWN_VALUE_CODES.has(code) && start.line === start.cell.last) {
        return;
      }
      const end = fromVirtual(layout, item.range.end);
      const to =
        end !== null && end.cell.id === start.cell.id
          ? { line: end.line, character: end.character }
          : { line: start.line, character: Number.MAX_SAFE_INTEGER };
      const severity = SEVERITIES[(item.severity ?? 1) - 1] ?? 'error';
      byCell.set(start.cell.id, [
        ...(byCell.get(start.cell.id) ?? []),
        {
          from: { line: start.line, character: start.character },
          to,
          severity,
          message: item.message,
          source: [item.source, server].filter(Boolean).join(' · ') || undefined,
        },
      ]);
      problems.push({
        severity,
        message: item.message,
        source: item.source,
        code,
        cell: start.cell.index,
        line: start.line,
        character: start.character,
      });
    });

    const before = new Set(this.known.keys());
    this.known = new Map(
      layout.cells.map((cell) => [
        cell.id,
        { source: cell.source, list: byCell.get(cell.id) ?? [] },
      ])
    );
    new Set([...before, ...this.known.keys()]).forEach((cellId) => this.draw(cellId));
    return problems;
  }

  /** Draws what is known about a cell in its editor, carried across whatever has been typed since. */
  draw(cellId: string): void {
    const view = this.viewFor(cellId);
    if (view === null) {
      return;
    }
    const known = this.known.get(cellId);
    if (known === undefined) {
      this.clearCell(cellId);
      return;
    }
    const sent = Text.of(known.source.split('\n'));
    const now = view.state.doc.toString();
    const since = ChangeSet.of(changeBetween(known.source, now), known.source.length);
    const drawn: Diagnostic[] = known.list.map((item) => {
      const from = since.mapPos(offsetAt(sent, item.from), 1);
      const to = since.mapPos(offsetAt(sent, item.to), -1);
      return {
        from,
        to: Math.max(from, to),
        severity: item.severity,
        message: item.message,
        source: item.source,
      };
    });
    view.dispatch(setDiagnostics(view.state, drawn));
  }

  private clearCell(cellId: string): void {
    const view = this.viewFor(cellId);
    if (view !== null) {
      view.dispatch(setDiagnostics(view.state, []));
    }
  }
}
