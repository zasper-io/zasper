import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { MatchKey, replaceInFiles, SearchFile, SearchLine } from '@/api';
import { LineEdit, openDocument } from '@/store/openDocuments';
import {
  contentQuery,
  leftOutAtom,
  matchedText,
  matchId,
  matchKeyOf,
  searchOptionsAtom,
  searchRerunAtom,
} from '@/store/projectSearch';

/** Which matches of one file to replace: its lines, each carrying only the ranges to replace. */
export interface ReplaceTarget {
  file: SearchFile;
  lines: SearchLine[];
}

export interface ReplaceReport {
  replaced: number;
  files: number;
  /** Matches an open editor no longer held where the search found them. */
  stale: number;
  failed: { path: string; message: string }[];
}

/** The edits that carry out a target in an open editor. What a cell printed is never replaced. */
export function editsFor(target: ReplaceTarget): LineEdit[] {
  return target.lines
    .filter((line) => line.output !== true)
    .flatMap((line) =>
      line.ranges
        .filter((range) => range.replacement !== undefined)
        .map((range) => ({
          cell: line.cell,
          line: line.line,
          from: range.from,
          to: range.to,
          expected: matchedText(line, range),
          insert: range.replacement ?? '',
        }))
    );
}

/** The matches of the file the target leaves out, which the server is told to skip. */
export function skippedKeys(target: ReplaceTarget): MatchKey[] {
  const kept = new Set(
    target.lines.flatMap((line) =>
      line.ranges.map((range) => matchId(target.file.path, line, range))
    )
  );
  return target.file.lines
    .filter((line) => line.output !== true)
    .flatMap((line) =>
      line.ranges
        .filter((range) => !kept.has(matchId(target.file.path, line, range)))
        .map((range) => matchKeyOf(line, range))
    );
}

/** How many of the targets' files a replace would write on disk, where no editor can undo it. */
export function notOpenCount(targets: ReplaceTarget[]): number {
  return targets.filter(
    (target) => editsFor(target).length > 0 && openDocument(target.file.path) === undefined
  ).length;
}

/**
 * Replaces across the project: in the editor, for a file that is open in one, and on the server for the
 * rest. Searches again afterwards, because the list it acted on is no longer true.
 */
export function useProjectReplace(): (targets: ReplaceTarget[]) => Promise<ReplaceReport> {
  const options = useAtomValue(searchOptionsAtom);
  const setRerun = useSetAtom(searchRerunAtom);
  const setLeftOut = useSetAtom(leftOutAtom);

  return useCallback(
    async (targets: ReplaceTarget[]) => {
      const report: ReplaceReport = { replaced: 0, files: 0, stale: 0, failed: [] };
      const onDisk: { path: string; skip: MatchKey[] }[] = [];
      // What an open editor now holds is unsaved, and the search reads the disk: left in the list, a
      // replaced match would be offered again against text that is no longer there.
      const doneInEditors: string[] = [];

      for (const target of targets) {
        const edits = editsFor(target);
        if (edits.length === 0) {
          continue;
        }
        const editor = openDocument(target.file.path);
        if (editor === undefined) {
          onDisk.push({ path: target.file.path, skip: skippedKeys(target) });
          continue;
        }
        const outcome = editor.applyEdits(edits);
        report.replaced += outcome.applied;
        report.stale += outcome.stale;
        if (outcome.applied > 0) {
          report.files += 1;
          target.lines
            .filter((line) => line.output !== true)
            .forEach((line) =>
              line.ranges.forEach((range) =>
                doneInEditors.push(matchId(target.file.path, line, range))
              )
            );
        }
      }

      if (doneInEditors.length > 0) {
        setLeftOut((current) => ({ ...current, matches: [...current.matches, ...doneInEditors] }));
      }
      try {
        if (onDisk.length > 0) {
          const outcome = await replaceInFiles(
            contentQuery({ ...options, replacing: true }),
            onDisk
          );
          report.replaced += outcome.replacements;
          report.files += outcome.files;
          report.failed.push(...outcome.failed);
        }
      } finally {
        setRerun((count) => count + 1);
      }
      return report;
    },
    [options, setRerun, setLeftOut]
  );
}
