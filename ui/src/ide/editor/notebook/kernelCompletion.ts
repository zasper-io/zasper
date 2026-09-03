import {
  acceptCompletion,
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
  startCompletion,
} from '@codemirror/autocomplete';
import { indentMore } from '@codemirror/commands';
import { KeyBinding } from '@codemirror/view';

import { ICompleteReply } from './kernelMessages';

/**
 * Completions come from the kernel rather than from the editor, which is the whole point: only
 * the kernel knows that `df` is a DataFrame and what its columns are called. @codemirror/lang-python
 * offers nothing to fall back on either — the pinned 6.0.0 predates its own completion sources —
 * so with no kernel running a code cell has no suggestions at all.
 */
type CompletionRequest = (source: string, cursorPos: number) => Promise<ICompleteReply | null>;

/**
 * IPython's kinds, mapped onto the ones @codemirror/autocomplete draws an icon for. Anything
 * unlisted (or a kernel that sends no kinds at all) gets no icon, which is the neutral result
 * rather than a wrong one.
 */
const COMPLETION_TYPES: Record<string, string> = {
  function: 'function',
  method: 'method',
  class: 'class',
  module: 'namespace',
  keyword: 'keyword',
  magic: 'keyword',
  instance: 'variable',
  statement: 'variable',
  property: 'property',
  path: 'text',
};

/**
 * Wraps a `complete_request` round trip as a CodeMirror completion source.
 *
 * One caveat in the offsets: the protocol counts `cursor_pos` in unicode code points while
 * CodeMirror counts UTF-16 code units, so a cell with an emoji before the cursor can complete
 * against a position a character or two off. Kernels and JupyterLab have the same seam.
 */
export function kernelCompletionSource(request: CompletionRequest): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const reply = await request(context.state.doc.toString(), context.pos);

    if (!reply || reply.status !== 'ok' || !reply.matches || reply.matches.length === 0) {
      return null;
    }

    const kinds = reply.metadata?._jupyter_types_experimental;

    const options: Completion[] = reply.matches.map((label, index) => {
      // Matched by text, because a kernel is not obliged to return the kinds in the order of
      // `matches`; by index only as a fallback, which is the order IPython does use.
      const kind = kinds?.find((entry) => entry.text === label)?.type ?? kinds?.[index]?.type;
      const type = kind ? COMPLETION_TYPES[kind] : undefined;
      return type ? { label, type } : { label };
    });

    return {
      from: reply.cursor_start,
      to: reply.cursor_end,
      options,
      // Typing more of the same word filters this list in the editor instead of asking the
      // kernel again on every keystroke. Anything else — a bracket, a space — re-queries.
      validFor: /^[\w.]*$/,
    };
  };
}

/**
 * Jupyter's Tab: take the highlighted suggestion if the popup is open, otherwise ask for
 * suggestions if there is a word to the left of the cursor, otherwise indent. Without this Tab
 * does nothing at all in a cell, since neither CodeMirror's default keymap nor its completion
 * keymap binds it.
 *
 * Bindings are tried in order and a `false` falls through to the next, so `acceptCompletion`
 * first is what makes the popup case take precedence without either branch testing for the other.
 */
export const tabCompletionKeymap: KeyBinding[] = [
  {
    key: 'Tab',
    run: acceptCompletion,
  },
  {
    key: 'Tab',
    run: (view) => {
      const { main } = view.state.selection;
      const before = main.empty
        ? view.state.doc.sliceString(Math.max(0, main.from - 1), main.from)
        : '';

      // A closing bracket or quote counts: `df.loc[0].` and `"a b".` both complete.
      return /[\w.)\]'"]/.test(before) ? startCompletion(view) : indentMore(view);
    },
  },
];
