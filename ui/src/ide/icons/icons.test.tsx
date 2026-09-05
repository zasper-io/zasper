import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import FileMark, { markFor } from './FileMark';
import Icon from './Icon';
import { ICONS } from './icons';

describe('markFor', () => {
  it('reads the extension, whatever case it is written in', () => {
    expect(markFor('train.py')).toEqual({ label: 'py', kind: 'python' });
    expect(markFor('Train.PY')).toEqual({ label: 'py', kind: 'python' });
  });

  it('gives one language one colour across its extensions', () => {
    const kinds = ['app.js', 'app.mjs', 'app.cjs'].map((name) => markFor(name));
    expect(new Set(kinds.map((mark) => typeof mark !== 'string' && mark.kind))).toEqual(
      new Set(['javascript'])
    );
  });

  it('matches the whole name for the files that have no extension', () => {
    expect(markFor('Makefile')).toEqual({ label: 'mk', kind: 'plain' });
    expect(markFor('LICENSE')).toEqual({ label: 'lic', kind: 'plain' });
    // `.gitignore` splits to the extension `gitignore`, which is the other way in.
    expect(markFor('.gitignore')).toEqual({ label: 'git', kind: 'plain' });
  });

  it('looks at the last segment of a path', () => {
    expect(markFor('src/store/TabState.tsx')).toEqual({ label: 'tsx', kind: 'react' });
  });

  it('draws an icon where letters would say nothing', () => {
    expect(markFor('plot.png')).toBe('image');
  });

  it('falls back to a plain file, which is the commonest case in a real project', () => {
    expect(markFor('notes.wat')).toBe('file');
    expect(markFor('CHANGELOG')).toBe('file');
  });

  it('never labels a mark with more than the 18px box holds', () => {
    const names = ['a.py', 'a.ipynb', 'a.cpp', 'a.json', 'a.html', 'a.tsx', 'Makefile', 'a.toml'];

    for (const name of names) {
      const mark = markFor(name);
      expect(mark, `${name} should have a mark`).not.toBeTypeOf('string');
      if (typeof mark !== 'string') {
        expect(mark.label.length, `${name} → '${mark.label}'`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('names an icon the table actually has', () => {
    const mark = markFor('plot.png');
    expect(typeof mark === 'string' && mark in ICONS).toBe(true);
  });
});

describe('FileMark', () => {
  it('colours a mark by language, not by extension', () => {
    const { container } = render(<FileMark name="setup.py" />);

    const mark = container.querySelector('.file-mark');
    expect(mark?.textContent).toBe('py');
    expect(mark?.className).toContain('file-mark-python');
  });

  it('says nothing to a screen reader, because the file name already says the type', () => {
    const { container } = render(<FileMark name="setup.py" />);

    expect(container.querySelector('.file-mark')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Icon', () => {
  it('draws in currentColor, so no surface has to recolour it', () => {
    const { container } = render(<Icon name="folder" />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('is square at the size asked for', () => {
    const { container } = render(<Icon name="lock" size={12} />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '12');
    expect(svg).toHaveAttribute('height', '12');
  });
});
