import { ChangeSpec } from '@codemirror/state';

import { applyFileEdits, FileEdits } from '@/api';
import { pathOfUri } from './languages';
import { offsetAt, ProtocolPosition } from './positions';
import { editorViewFor } from './views';

export interface ProtocolRange {
  start: ProtocolPosition;
  end: ProtocolPosition;
}

/** One replacement, as the protocol shapes it: a range and the text that takes its place. */
export interface ProtocolTextEdit {
  range: ProtocolRange;
  newText: string;
}

/**
 * What a server answers a rename or a code action with. Only the two text-editing shapes are read: a
 * `documentChanges` list of edits per document, and the older `changes` map. Creating, renaming and
 * deleting files are in the protocol's own union and are left alone — nothing here asks for them, and a
 * server that sends one anyway is told what was not carried out.
 */
export interface ProtocolWorkspaceEdit {
  changes?: Record<string, ProtocolTextEdit[]>;
  documentChanges?: {
    textDocument?: { uri: string; version?: number | null };
    edits?: ProtocolTextEdit[];
    kind?: string;
  }[];
}

export interface FileChange {
  path: string;
  edits: ProtocolTextEdit[];
}

export interface EditOutcome {
  /** Files edited in their own editor, where the change is undoable. */
  inEditors: string[];
  /** Files written on disk, because no editor holds them. */
  onDisk: string[];
  /** Files nothing could be done about, with the reason. */
  failed: { path: string; reason: string }[];
  /** Edits the server asked for that are not text: a file created, renamed or deleted. */
  skipped: number;
}

/** A server's edit read as one list of edits per file, in the project's own paths. */
export function fileChanges(
  root: string,
  edit: ProtocolWorkspaceEdit
): { changes: FileChange[]; skipped: number; outside: number } {
  const byPath = new Map<string, ProtocolTextEdit[]>();
  let skipped = 0;
  let outside = 0;

  const add = (uri: string, edits: ProtocolTextEdit[]) => {
    const path = pathOfUri(root, uri);
    if (path === null) {
      outside += 1;
      return;
    }
    byPath.set(path, [...(byPath.get(path) ?? []), ...edits]);
  };

  // documentChanges first, and the map is not read as well: a server that sends both means the same edit
  // twice, and the protocol says documentChanges wins where a client understands it.
  if (edit.documentChanges !== undefined) {
    edit.documentChanges.forEach((change) => {
      if (change.textDocument === undefined || change.edits === undefined) {
        skipped += 1;
        return;
      }
      add(change.textDocument.uri, change.edits);
    });
  } else if (edit.changes !== undefined) {
    Object.entries(edit.changes).forEach(([uri, edits]) => add(uri, edits));
  }

  return {
    changes: [...byPath.entries()].map(([path, edits]) => ({ path, edits })),
    skipped,
    outside,
  };
}

/** How many files a change list touches, and how many of them no editor holds. */
export function editReach(changes: FileChange[]): {
  edits: number;
  files: number;
  notOpen: number;
} {
  return {
    edits: changes.reduce((count, change) => count + change.edits.length, 0),
    files: changes.length,
    notOpen: changes.filter((change) => editorViewFor(change.path) === null).length,
  };
}

/**
 * Carries out a server's edit.
 *
 * A file with an editor is edited in it, as one undoable change, so the reader can take a rename back with
 * `⌘Z` and the file stays unsaved until they save it. A file with no editor is written on the server,
 * which is the part that cannot be undone here — the count shown before a rename says how many those are.
 */
export async function applyWorkspaceEdit(
  root: string,
  edit: ProtocolWorkspaceEdit
): Promise<EditOutcome> {
  const { changes, skipped, outside } = fileChanges(root, edit);
  const outcome: EditOutcome = { inEditors: [], onDisk: [], failed: [], skipped };
  if (outside > 0) {
    outcome.failed.push({
      path: '',
      reason: `${outside} ${outside === 1 ? 'file' : 'files'} outside the project were left alone.`,
    });
  }

  const forDisk: FileEdits[] = [];
  changes.forEach((change) => {
    const view = editorViewFor(change.path);
    if (view === null) {
      forDisk.push({
        path: change.path,
        edits: change.edits.map((item) => ({
          start: item.range.start,
          end: item.range.end,
          new_text: item.newText,
        })),
      });
      return;
    }
    const doc = view.state.doc;
    const specs: ChangeSpec[] = change.edits.map((item) => ({
      from: offsetAt(doc, item.range.start),
      to: offsetAt(doc, item.range.end),
      insert: item.newText,
    }));
    view.dispatch({ changes: specs, userEvent: 'input.rename' });
    outcome.inEditors.push(change.path);
  });

  if (forDisk.length > 0) {
    const results = await applyFileEdits(forDisk);
    results.forEach((result) => {
      if (result.error !== undefined && result.error !== '') {
        outcome.failed.push({ path: result.path, reason: result.error });
      } else {
        outcome.onDisk.push(result.path);
      }
    });
  }
  return outcome;
}
