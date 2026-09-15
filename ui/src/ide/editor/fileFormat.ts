import type { ChangeSpec, Text } from '@codemirror/state';

import type { EditorConfig, EditorSettings } from '@/api';
import type { FileFormat, Indentation, LineEnding } from '@/store/editorStatus';

/** How the file's lines end, by majority; null for a file with no line break to tell by. */
export function detectLineEnding(text: string): LineEnding | null {
  let crlf = 0;
  let lf = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    if (at > 0 && text[at - 1] === '\r') {
      crlf++;
    } else {
      lf++;
    }
  }
  if (crlf === 0 && lf === 0) {
    return null;
  }
  return crlf > lf ? 'CRLF' : 'LF';
}

/**
 * How the file's lines are indented: by tabs or spaces, whichever more indented lines start with, and for
 * spaces the step most often taken from one line's indent to the next. A step of one is alignment rather
 * than indentation, and is not counted. Null for a file with no indented line.
 */
export function detectIndentation(text: string, tabSizeForTabs: number): Indentation | null {
  let tabs = 0;
  let spaces = 0;
  const steps = new Map<number, number>();
  let previous = 0;

  for (const line of text.split(/\r\n?|\n/)) {
    if (line.trim() === '') {
      continue;
    }
    const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
    if (indent.startsWith('\t')) {
      tabs++;
      continue;
    }
    if (indent.length > 0) {
      spaces++;
    }
    const step = Math.abs(indent.length - previous);
    if (step >= 2 && step <= 8) {
      steps.set(step, (steps.get(step) ?? 0) + 1);
    }
    previous = indent.length;
  }

  if (tabs === 0 && spaces === 0) {
    return null;
  }
  if (tabs > spaces) {
    return { indentWithTabs: true, tabSize: tabSizeForTabs };
  }
  let best = 0;
  let seen = 0;
  steps.forEach((count, step) => {
    if (count > seen || (count === seen && step < best)) {
      best = step;
      seen = count;
    }
  });
  return best === 0 ? null : { indentWithTabs: false, tabSize: best };
}

/**
 * A file's format as it is opened: its .editorconfig first, then the editor settings. Line endings are the
 * file's own unless its .editorconfig names them, so a CRLF file is saved as CRLF.
 */
export function formatFor(
  text: string,
  settings: EditorSettings,
  editorConfig: EditorConfig
): FileFormat {
  const tabWidth = editorConfig.tab_width || editorConfig.indent_size || settings.tab_size;
  const detected = detectIndentation(text, tabWidth);
  const trim = editorConfig.trim_trailing_whitespace ?? null;
  const finalNewline = editorConfig.insert_final_newline ?? null;
  const eol: LineEnding =
    editorConfig.end_of_line === 'crlf'
      ? 'CRLF'
      : editorConfig.end_of_line === 'lf'
        ? 'LF'
        : (detectLineEnding(text) ?? 'LF');

  if (editorConfig.indent_style !== undefined || editorConfig.indent_size !== undefined) {
    return {
      indentWithTabs:
        editorConfig.indent_style === undefined
          ? settings.indent_with_tabs
          : editorConfig.indent_style === 'tab',
      tabSize: editorConfig.indent_size || tabWidth,
      eol,
      detected,
      source: 'editorconfig',
      trim,
      finalNewline,
    };
  }
  return {
    indentWithTabs: settings.indent_with_tabs,
    tabSize: settings.tab_size,
    eol,
    detected,
    source: 'settings',
    trim,
    finalNewline,
  };
}

/** The indentation a file is edited with: the settings', unless its .editorconfig or the reader gave it its own. */
export function indentationOf(
  format: FileFormat | undefined,
  settings: EditorSettings
): Indentation {
  if (format === undefined || format.source === 'settings') {
    return { indentWithTabs: settings.indent_with_tabs, tabSize: settings.tab_size };
  }
  return { indentWithTabs: format.indentWithTabs, tabSize: format.tabSize };
}

/** What a save does to whitespace: the file's .editorconfig where it has a rule, else the settings. */
export function saveRulesOf(format: FileFormat | undefined, settings: EditorSettings): SaveRules {
  return {
    trim: format?.trim ?? settings.trim_trailing_whitespace,
    finalNewline: format?.finalNewline ?? settings.insert_final_newline,
  };
}

export interface SaveRules {
  trim: boolean;
  finalNewline: boolean;
}

/**
 * The edits a save makes to the document before writing it: blanks off the end of each line, and one
 * newline at the end of the file. Edits rather than a rewritten string, so the editor holds what was
 * written and the cursor is moved only where its own line changed.
 */
export function tidyChanges(doc: Text, rules: SaveRules): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  let lastLine = doc.line(doc.lines).text;

  if (rules.trim) {
    for (let number = 1; number <= doc.lines; number++) {
      const line = doc.line(number);
      const kept = line.text.replace(/[ \t]+$/, '');
      if (kept.length !== line.text.length) {
        changes.push({ from: line.from + kept.length, to: line.to });
        if (number === doc.lines) {
          lastLine = kept;
        }
      }
    }
  }

  // A document whose last line still has something on it ends without a newline. An empty document is
  // left alone: a newline would be the whole of its content.
  if (rules.finalNewline && doc.length > 0 && lastLine !== '') {
    changes.push({ from: doc.length, insert: '\n' });
  }
  return changes;
}
