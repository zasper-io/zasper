import { ChangeSet, ChangeSpec, Text } from '@codemirror/state';

import { LineEdit } from '@/store/openDocuments';

/** The changes that carry out `edits` in `doc`, leaving out each one whose text is no longer there. */
export function lineEditChanges(
  doc: Text,
  edits: LineEdit[]
): { changes: ChangeSpec[]; stale: number } {
  const changes: ChangeSpec[] = [];
  let stale = 0;
  for (const edit of edits) {
    if (edit.line < 1 || edit.line > doc.lines) {
      stale += 1;
      continue;
    }
    const line = doc.line(edit.line);
    const from = line.from + edit.from;
    const to = line.from + edit.to;
    if (to > line.to || doc.sliceString(from, to) !== edit.expected) {
      stale += 1;
      continue;
    }
    changes.push({ from, to, insert: edit.insert });
  }
  return { changes, stale };
}

/** `lineEditChanges` over a string, for a cell whose source no editor holds. */
export function editedText(
  text: string,
  edits: LineEdit[]
): { text: string; applied: number; stale: number } {
  const doc = Text.of(text.split('\n'));
  const { changes, stale } = lineEditChanges(doc, edits);
  return {
    text: ChangeSet.of(changes, doc.length).apply(doc).toString(),
    applied: changes.length,
    stale,
  };
}
