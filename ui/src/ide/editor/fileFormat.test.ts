import { describe, expect, it } from 'vitest';

import { DEFAULT_EDITOR_SETTINGS } from '@/store/settings';
import type { FileFormat } from '@/store/editorStatus';
import { detectIndentation, detectLineEnding, formatFor, indentationOf } from './fileFormat';

describe('detectLineEnding', () => {
  it('reads the line endings most lines have', () => {
    expect(detectLineEnding('a\nb\n')).toBe('LF');
    expect(detectLineEnding('a\r\nb\r\nc\n')).toBe('CRLF');
  });

  it('has no answer for a file without a line break', () => {
    expect(detectLineEnding('one line')).toBeNull();
  });
});

describe('detectIndentation', () => {
  it('reads the step between one indent and the next', () => {
    expect(detectIndentation('def f():\n    if x:\n        y\n    z\n', 8)).toEqual({
      indentWithTabs: false,
      tabSize: 4,
    });
    expect(detectIndentation('a:\n  b:\n    c: 1\n  d: 2\n', 8)).toEqual({
      indentWithTabs: false,
      tabSize: 2,
    });
  });

  it('reads tabs, at the width it is given', () => {
    expect(detectIndentation('func f() {\n\tif y {\n\t\tz\n\t}\n}\n', 8)).toEqual({
      indentWithTabs: true,
      tabSize: 8,
    });
  });

  it('has no answer for a file with nothing indented', () => {
    expect(detectIndentation('a\nb\n', 4)).toBeNull();
  });
});

describe('formatFor', () => {
  it('follows the settings, and keeps the file’s own line endings', () => {
    const format = formatFor('a\r\n    b\r\n', DEFAULT_EDITOR_SETTINGS, {});

    expect(format).toMatchObject({ source: 'settings', eol: 'CRLF' });
  });

  it('lets a project’s .editorconfig win', () => {
    const format = formatFor('a\n', DEFAULT_EDITOR_SETTINGS, {
      indent_style: 'tab',
      indent_size: 8,
      end_of_line: 'crlf',
    });

    expect(format).toMatchObject({
      source: 'editorconfig',
      indentWithTabs: true,
      tabSize: 8,
      eol: 'CRLF',
    });
  });
});

describe('indentationOf', () => {
  const format: FileFormat = {
    indentWithTabs: true,
    tabSize: 8,
    eol: 'LF',
    detected: null,
    source: 'chosen',
  };

  it('keeps a file’s own indentation', () => {
    expect(indentationOf(format, DEFAULT_EDITOR_SETTINGS)).toEqual({
      indentWithTabs: true,
      tabSize: 8,
    });
  });

  it('follows the settings for a file that has none of its own', () => {
    expect(indentationOf({ ...format, source: 'settings' }, DEFAULT_EDITOR_SETTINGS)).toEqual({
      indentWithTabs: false,
      tabSize: 4,
    });
  });
});
