import {
  autocompletion,
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import { linter } from '@codemirror/lint';
import { Extension, Prec, StateEffect, StateField } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap, showTooltip, Tooltip } from '@codemirror/view';
import { AnsiUp } from 'ansi_up';

import type { NotebookLanguageServer } from '@/lsp/notebookServer';
import { documentationElement } from '@/lsp/notebookServer';
import { CompleteReply, InspectReply } from './kernelMessages';
import { kernelCompletionSource } from './kernelCompletion';

/** Once the server has answered, how much longer the kernel's answer is worth waiting for. */
const KERNEL_GRACE_MS = 300;

export interface CellIntelligenceOptions {
  cellId: string;
  server: NotebookLanguageServer | null;
  requestCompletions: (source: string, cursorPos: number) => Promise<CompleteReply | null>;
  requestInspection: (
    source: string,
    cursorPos: number,
    detailLevel?: 0 | 1
  ) => Promise<InspectReply | null>;
  /** Whether the kernel would answer now, rather than after the cell it is running. */
  kernelIdle: () => boolean;
}

/**
 * The kernel's list and the server's as one. The kernel's comes first and wins a name both offer — it
 * knows what `df` is at runtime, where the server only knows the source — and the server's adds what the
 * kernel does not know yet: names from cells that have not run, and documentation. When the two disagree
 * about what is being completed (a dictionary key, a path) the kernel's answer is taken alone.
 */
export function mergeCompletions(
  kernel: CompletionResult | null,
  server: CompletionResult | null
): CompletionResult | null {
  if (kernel === null || server === null) {
    return kernel ?? server;
  }
  if (kernel.from !== server.from) {
    return kernel;
  }
  const fromServer = new Map(server.options.map((option) => [option.label, option]));
  const options: Completion[] = kernel.options.map((option) => {
    const known = fromServer.get(option.label);
    fromServer.delete(option.label);
    return known === undefined
      ? option
      : { ...option, type: option.type ?? known.type, detail: known.detail, info: known.info };
  });
  return {
    ...kernel,
    options: [...options, ...fromServer.values()],
    validFor: kernel.validFor,
  };
}

function withGrace<T>(promise: Promise<T | null>, after: Promise<unknown>): Promise<T | null> {
  return Promise.race([
    promise,
    after.then(
      () => new Promise<null>((resolve) => window.setTimeout(() => resolve(null), KERNEL_GRACE_MS))
    ),
  ]);
}

/**
 * Who a completion is asked of. The server while typing, as VS Code does: it answers from the source, in
 * its own process. The kernel only when asked — Tab or Ctrl-Space — or straight after a `.` while it is
 * idle, which is where its runtime answer is worth most: a kernel handles one request at a time,
 * publishes busy and idle for each, and completes by looking at live objects.
 */
export function completionAsks(
  explicit: boolean,
  afterDot: boolean,
  kernelIdle: boolean
): { kernel: boolean; server: boolean } {
  return { kernel: explicit || (afterDot && kernelIdle), server: true };
}

function notebookCompletionSource(options: CellIntelligenceOptions): CompletionSource {
  const fromKernel = kernelCompletionSource(options.requestCompletions);
  return async (context: CompletionContext) => {
    const { server } = options;
    const afterDot = context.matchBefore(/\.\w*$/) !== null;
    const asks = completionAsks(context.explicit, afterDot, options.kernelIdle());
    const kernelAnswer = asks.kernel ? Promise.resolve(fromKernel(context)) : Promise.resolve(null);
    if (server === null) {
      return kernelAnswer;
    }
    const serverAnswer = server.complete(options.cellId, context).catch(() => null);
    const [kernel, fromServer] = await Promise.all([
      withGrace(kernelAnswer, serverAnswer),
      serverAnswer,
    ]);
    return mergeCompletions(kernel, fromServer);
  };
}

const ansi = new AnsiUp();
ansi.use_classes = true;

/** What the kernel said about a name: IPython's `?` text, with its coloured headings. */
function inspectionElement(reply: InspectReply): HTMLElement | null {
  const text = reply.data?.['text/plain'];
  if (reply.status !== 'ok' || !reply.found || typeof text !== 'string' || text.trim() === '') {
    return null;
  }
  const element = documentationElement('');
  element.classList.add('cm-kernel-doc');
  const pre = document.createElement('pre');
  pre.innerHTML = ansi.ansi_to_html(text);
  element.appendChild(pre);
  return element;
}

async function kernelTooltip(
  options: CellIntelligenceOptions,
  view: EditorView,
  pos: number
): Promise<Tooltip | null> {
  const reply = await options.requestInspection(view.state.doc.toString(), pos, 0);
  const dom = reply === null ? null : inspectionElement(reply);
  if (dom === null) {
    return null;
  }
  const word = view.state.wordAt(pos);
  return { pos: word?.from ?? pos, end: word?.to ?? pos, above: true, create: () => ({ dom }) };
}

/** Hover: the language server, which answers from the source at once; the kernel when there is none. */
function hoverSource(options: CellIntelligenceOptions) {
  return async (view: EditorView, pos: number): Promise<Tooltip | null> => {
    if (view.state.wordAt(pos) === null) {
      return null;
    }
    const fromServer = await options.server?.hover(options.cellId, view, pos).catch(() => null);
    if (fromServer) {
      return fromServer;
    }
    return options.kernelIdle() ? kernelTooltip(options, view, pos) : null;
  };
}

const showDocumentation = StateEffect.define<Tooltip | null>();

/** Shift+Tab's card, which stays until the cursor moves or the text changes. */
const documentationField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(showDocumentation)) {
        return effect.value;
      }
    }
    return transaction.docChanged || transaction.selection ? null : value;
  },
  provide: (field) => showTooltip.from(field),
});

/**
 * Jupyter's Shift+Tab: the kernel's documentation for the name at the cursor, which knows the object as it
 * is at runtime. The server's hover when the kernel has nothing to say.
 */
function inspectAtCursor(options: CellIntelligenceOptions) {
  return (view: EditorView): boolean => {
    const pos = view.state.selection.main.head;
    const word = view.state.wordAt(pos) ?? view.state.wordAt(Math.max(0, pos - 1));
    if (word === null) {
      return false;
    }
    // A server finds no name at the end of one, which is where the cursor is after typing it.
    const inWord = Math.min(pos, word.to - 1);
    void kernelTooltip(options, view, pos)
      .then((tooltip) => tooltip ?? options.server?.hover(options.cellId, view, inWord) ?? null)
      .catch(() => null)
      .then((tooltip) => {
        if (tooltip && view.state.selection.main.head === pos) {
          view.dispatch({ effects: showDocumentation.of({ ...tooltip, pos }) });
        }
      });
    return true;
  };
}

/**
 * What a code cell knows about its code: completion, hover and Shift+Tab documentation from the kernel and
 * the language server, and the state the server's problems are drawn from — `linter(null)` for the reason
 * `languageServerExtension` gives, which applies all the more to a cell, reconfigured on every change of
 * the notebook's server.
 */
export function cellIntelligence(options: CellIntelligenceOptions, shiftTab: boolean): Extension {
  return [
    autocompletion({ override: [notebookCompletionSource(options)] }),
    hoverTooltip(hoverSource(options), { hideOn: (transaction) => transaction.docChanged }),
    documentationField,
    // Ahead of the `indentWithTab` that @uiw/react-codemirror adds, which would dedent on Shift+Tab.
    Prec.high(
      keymap.of([
        ...(shiftTab ? [{ key: 'Shift-Tab', run: inspectAtCursor(options) }] : []),
        {
          key: 'Escape',
          run: (view) => {
            if (view.state.field(documentationField) === null) {
              return false;
            }
            view.dispatch({ effects: showDocumentation.of(null) });
            return true;
          },
        },
      ])
    ),
    linter(null),
  ];
}
