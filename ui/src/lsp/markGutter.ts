import { Diagnostic, forEachDiagnostic, setDiagnosticsEffect } from '@codemirror/lint';
import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';

import { Severity } from '@/store/languageServers';

/** Says which line has a fix to offer, or none. Lines count from 1, as CodeMirror's do. */
export const setFixLine = StateEffect.define<number | null>();

const fixLine = StateField.define<number | null>({
  create: () => null,
  update(line, transaction) {
    let next = line;
    for (const effect of transaction.effects) {
      if (effect.is(setFixLine)) {
        next = effect.value;
      }
    }
    // A line that has been edited is a line the server has not seen, so the lamp goes until it answers
    // again; the mapping keeps the lamp with its line while text above it changes.
    return next === null || !transaction.docChanged
      ? next
      : transaction.newDoc.lineAt(
          transaction.changes.mapPos(transaction.startState.doc.line(next).from)
        ).number;
  },
});

const RANK: Record<string, number> = { error: 0, warning: 1, info: 2, hint: 3 };

class SeverityMarker extends GutterMarker {
  constructor(private readonly severity: string) {
    super();
  }

  eq(other: SeverityMarker): boolean {
    return other.severity === this.severity;
  }

  toDOM(): Node {
    const mark = document.createElement('span');
    mark.className = `cm-markGutter-mark is-${this.severity}`;
    return mark;
  }
}

class FixMarker extends GutterMarker {
  eq(): boolean {
    return true;
  }

  toDOM(): Node {
    const lamp = document.createElement('span');
    lamp.className = 'cm-markGutter-mark is-fix';
    lamp.title = 'Fixes and refactors for this line';
    return lamp;
  }
}

const FIX = new FixMarker();
const MARKERS = new Map<string, SeverityMarker>();

function severityMarker(severity: string): SeverityMarker {
  const known = MARKERS.get(severity);
  if (known !== undefined) {
    return known;
  }
  const made = new SeverityMarker(severity);
  MARKERS.set(severity, made);
  return made;
}

/**
 * The worst severity of the diagnostics on a line, or null when it has none.
 *
 * A hint is not one of them: an unused import is drawn as faded text, and a mark in the gutter beside it
 * would say a line is at fault when nothing is wrong with it. VS Code leaves its gutter empty there too.
 */
function severityOn(view: EditorView, from: number, to: number): Severity | null {
  let worst: string | null = null;
  forEachDiagnostic(view.state, (diagnostic: Diagnostic, start: number, end: number) => {
    if (end < from || start > to || diagnostic.severity === 'hint') {
      return;
    }
    if (worst === null || (RANK[diagnostic.severity] ?? 3) < RANK[worst]) {
      worst = diagnostic.severity;
    }
  });
  return worst as Severity | null;
}

/**
 * One gutter column for what is known about a line: the worst diagnostic on it, or — when it has none and
 * the cursor is there with something on offer — the lamp that opens the fixes (story 20).
 *
 * One column rather than two, which is the decision the drawing settled: the alternative was a lamp beside
 * every severity mark, competing for the same 16px on every hint in the file. A line with both a problem
 * and a fix shows the problem, and `⌘.` opens the fixes from the keyboard either way.
 */
export function markGutter(onLamp: (line: number) => void) {
  return [
    fixLine,
    gutter({
      class: 'cm-markGutter',
      lineMarker: (view, block) => {
        const line = view.state.doc.lineAt(block.from);
        const severity = severityOn(view, line.from, line.to);
        if (severity !== null) {
          return severityMarker(severity);
        }
        return view.state.field(fixLine) === line.number ? FIX : null;
      },
      // Redrawn when the document moves, when the lamp moves, and when a server publishes: the lint
      // state is not this field, so a new set of diagnostics is a change this gutter has to be told of.
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.startState.field(fixLine) !== update.state.field(fixLine) ||
        update.transactions.some((transaction) =>
          transaction.effects.some(
            (effect) => effect.is(setFixLine) || effect.is(setDiagnosticsEffect)
          )
        ),
      domEventHandlers: {
        mousedown: (view, block) => {
          const line = view.state.doc.lineAt(block.from).number;
          if (view.state.field(fixLine) !== line) {
            return false;
          }
          onLamp(line);
          return true;
        },
      },
    }),
  ];
}
