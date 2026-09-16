import { LSPPlugin } from '@codemirror/lsp-client';
import { Extension, Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';

import { offsetAt, ProtocolPosition } from './positions';

/** How long after a change or a scroll the hints for what is on screen are asked for. */
const ASK_DELAY = 300;

interface ServerHint {
  position: ProtocolPosition;
  label: string | { value: string }[];
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

interface Hint {
  at: number;
  text: string;
}

const setHints = StateEffect.define<Hint[]>();

class HintWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  eq(other: HintWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const hint = document.createElement('span');
    hint.className = 'cm-inlayHint';
    hint.textContent = this.text;
    return hint;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const hintField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(hints, transaction) {
    let next = hints.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setHints)) {
        const drawn: Range<Decoration>[] = effect.value.map((hint) =>
          Decoration.widget({ widget: new HintWidget(hint.text), side: 1 }).range(hint.at)
        );
        next = Decoration.set(drawn, true);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function textOf(label: ServerHint['label']): string {
  return typeof label === 'string' ? label : label.map((part) => part.value).join('');
}

/**
 * The parameter names and inferred types a server offers for what is on screen (story 20), drawn in the
 * line and absent from the file.
 *
 * Asked for the visible range only, and again a moment after a change or a scroll: a hint is worth one
 * request per pause, and a long file's worth of them is not. Off unless the reader turns it on, because
 * every hint moves the text of the line it is on.
 */
export function inlayHints(): Extension {
  return [
    hintField,
    ViewPlugin.fromClass(
      class {
        private timer: number | undefined;

        constructor(view: EditorView) {
          this.ask(view);
        }

        update(update: { view: EditorView; docChanged: boolean; viewportChanged: boolean }) {
          if (update.docChanged || update.viewportChanged) {
            this.ask(update.view);
          }
        }

        destroy() {
          window.clearTimeout(this.timer);
        }

        private ask(view: EditorView) {
          window.clearTimeout(this.timer);
          this.timer = window.setTimeout(() => {
            const plugin = LSPPlugin.get(view);
            const client = plugin?.client;
            if (plugin == null || client == null) {
              return;
            }
            if (client.serverCapabilities?.inlayHintProvider == null) {
              return;
            }
            const { from, to } = view.viewport;
            client.sync();
            void client
              .request<unknown, ServerHint[] | null>('textDocument/inlayHint', {
                textDocument: { uri: plugin.uri },
                range: { start: plugin.toPosition(from), end: plugin.toPosition(to) },
              })
              .then((answer) => {
                const doc = view.state.doc;
                const hints = (answer ?? []).map((hint) => ({
                  at: offsetAt(doc, hint.position),
                  text:
                    (hint.paddingLeft === true ? ' ' : '') +
                    textOf(hint.label) +
                    (hint.paddingRight === true ? ' ' : ''),
                }));
                view.dispatch({ effects: setHints.of(hints) });
              })
              .catch(() => {
                // A server that will not answer draws no hints, which is the state it was already in.
              });
          }, ASK_DELAY);
        }
      }
    ),
  ];
}
