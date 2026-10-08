import { EditorState, Extension, RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { MySQL, PostgreSQL, SQLDialect, SQLite, sql, StandardSQL } from '@codemirror/lang-sql';

/** Where the query starts: after the magic line and its newline. */
function headerEnd(state: EditorState): number {
  const first = state.doc.line(1);
  return Math.min(first.to + 1, state.doc.length);
}

class NothingWidget extends WidgetType {
  toDOM(): HTMLElement {
    return document.createElement('span');
  }
  eq(): boolean {
    return true;
  }
}

/**
 * The magic line, hidden: the cell's head shows what it says, as controls. A block that draws nothing, so
 * the query starts on the editor's first visible line.
 */
const hiddenHeader = StateField.define<DecorationSet>({
  create: (state) => decorate(state),
  update: (decorations, tr) => (tr.docChanged ? decorate(tr.state) : decorations),
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

function decorate(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const first = state.doc.line(1);
  builder.add(
    first.from,
    first.to,
    Decoration.replace({ widget: new NothingWidget(), block: true })
  );
  return builder.finish();
}

/**
 * Typing cannot reach the magic line, which only the head changes. Its changes come back as a new value
 * for the whole document, which is the one change let through.
 */
const guardHeader = EditorState.changeFilter.of((tr) => {
  let whole = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA === 0 && toA === tr.startState.doc.length) {
      whole = true;
    }
  });
  if (whole) {
    return true;
  }
  return [0, Math.max(0, headerEnd(tr.startState) - 1)];
});

/** The cursor is never left inside the hidden line. */
const keepCursorInQuery = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) {
    return tr;
  }
  const end = headerEnd(tr.state);
  const main = tr.newSelection.main;
  if (main.head >= end && main.anchor >= end) {
    return tr;
  }
  return [
    tr,
    {
      selection: { anchor: Math.max(main.anchor, end), head: Math.max(main.head, end) },
      sequential: true,
    },
  ];
});

const DIALECTS: Record<string, SQLDialect> = {
  postgresql: PostgreSQL,
  redshift: PostgreSQL,
  // DuckDB's SQL is PostgreSQL's in everything a highlighter sees.
  duckdb: PostgreSQL,
  dataframes: PostgreSQL,
  mysql: MySQL,
  sqlite: SQLite,
};

/** Tables and their columns, as completion is given them: `{ orders: ['id', 'total'] }`, schemas nested. */
export type SqlNamespace = Record<string, string[] | Record<string, string[]>>;

/** What a SQL cell's editor needs: the language, its schema for completion, and the hidden magic line. */
export function sqlCellExtensions(
  connectionType: string,
  namespace: SqlNamespace,
  defaultSchema?: string
): Extension[] {
  return [
    sql({
      dialect: DIALECTS[connectionType] ?? StandardSQL,
      schema: namespace,
      defaultSchema,
      upperCaseKeywords: true,
    }),
    hiddenHeader,
    guardHeader,
    keepCursorInQuery,
  ];
}
