import { describe, expect, it } from 'vitest';

import { isReportableCommandId, normalizeExtension } from './events';

describe('normalizeExtension', () => {
  it('reports the extensions worth telling apart', () => {
    expect(normalizeExtension('analysis.ipynb')).toBe('ipynb');
    expect(normalizeExtension('train.py')).toBe('py');
    expect(normalizeExtension('data.csv')).toBe('csv');
  });

  it('ignores everything but the extension, however long the path', () => {
    expect(normalizeExtension('/Users/anna/clients/acme/q3-forecast.ipynb')).toBe('ipynb');
    expect(normalizeExtension('notes/patients/2024-06-records.csv')).toBe('csv');
  });

  it('is case-insensitive, because the file system may not be', () => {
    expect(normalizeExtension('Model.PY')).toBe('py');
    expect(normalizeExtension('README.MD')).toBe('md');
  });

  it('collapses an unknown extension rather than passing it through', () => {
    expect(normalizeExtension('patient-records.xlsx')).toBe('other');
    expect(normalizeExtension('backup.tar.gz')).toBe('other');
  });

  it('says none when there is no extension', () => {
    expect(normalizeExtension('README')).toBe('none');
    expect(normalizeExtension('')).toBe('none');
  });

  it('treats a dotfile as all extension', () => {
    expect(normalizeExtension('.gitignore')).toBe('gitignore');
    expect(normalizeExtension('.env')).toBe('env');
  });

  it('recognises the two names that are the extension', () => {
    expect(normalizeExtension('Dockerfile')).toBe('dockerfile');
    expect(normalizeExtension('makefile')).toBe('makefile');
  });

  // The whole reason the mapping exists: a file name is the user's, and none of it may travel.
  it('never echoes any part of the name it was given', () => {
    const names = [
      'q3-forecast-acme.xlsx',
      '/Users/anna/patients.csv',
      'salary-review-2024.docx',
      'ACME Holdings.pdf',
    ];
    for (const name of names) {
      const result = normalizeExtension(name);
      expect(result).not.toContain('acme');
      expect(result).not.toContain('anna');
      expect(result).not.toContain('patient');
      expect(result).not.toContain('salary');
      expect(result).not.toContain('/');
    }
  });
});

describe('isReportableCommandId', () => {
  it('accepts the ids the app actually registers', () => {
    expect(isReportableCommandId('notebook:run-cell-and-advance')).toBe(true);
    expect(isReportableCommandId('view:zoom-in')).toBe(true);
    expect(isReportableCommandId('palette:open-commands')).toBe(true);
  });

  it('refuses anything a path or a line of code would fit in', () => {
    expect(isReportableCommandId('notebook:/Users/anna/secret.ipynb')).toBe(false);
    expect(isReportableCommandId('import pandas as pd')).toBe(false);
    expect(isReportableCommandId('run cell')).toBe(false);
    expect(isReportableCommandId('Notebook:RunCell')).toBe(false);
    expect(isReportableCommandId('notebook:run.cell')).toBe(false);
    expect(isReportableCommandId('')).toBe(false);
  });
});
