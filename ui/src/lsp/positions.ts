import { Text } from '@codemirror/state';

/** A place in a document as the protocol counts it: a line from 0, and UTF-16 units along it. */
export interface ProtocolPosition {
  line: number;
  character: number;
}

/**
 * The offset of a protocol position in doc. Held inside the document rather than refused: a server
 * answering about a version the editor has since moved past can name a line or a column that is gone,
 * and the end of what is there is the nearest honest place.
 *
 * The protocol's columns are UTF-16 code units, which is what a JavaScript string — and so a CodeMirror
 * line — is counted in, so a column is an offset into the line as it stands.
 */
export function offsetAt(doc: Text, position: ProtocolPosition): number {
  if (position.line < 0) {
    return 0;
  }
  if (position.line >= doc.lines) {
    return doc.length;
  }
  const line = doc.line(position.line + 1);
  return line.from + Math.min(Math.max(position.character, 0), line.length);
}
