import Icon from './Icon';
import type { IconName } from './icons';
import getFileExtension from '../utils';

/**
 * Which colour a mark takes. One per language rather than one per extension, so `.mjs` and `.cjs`
 * are the same yellow as `.js`, and the token names in _tokens.scss line up with these.
 */
type MarkKind =
  | 'python'
  | 'notebook'
  | 'json'
  | 'javascript'
  | 'typescript'
  | 'react'
  | 'go'
  | 'c'
  | 'cpp'
  | 'java'
  | 'html'
  | 'css'
  /** Everything whose colour would mean nothing: prose, config, a shell script. */
  | 'plain';

interface Mark {
  /** At most three characters — the box is 18px, and a fourth does not fit at 9px. */
  label: string;
  kind: MarkKind;
}

/*
What a file gets in front of its name: a mark, or an icon where letters would say less.

One set and one size, which was the part that was actually wrong before rather than the colour. What
this replaces is 24 files in public/images/editor from four different icon sets, with intrinsic widths
from 2.927px to 2500px, one of them declaring no width at all, and 21 of the 30 with a `fill` baked
into the file — which is why a selected row had to fake white with `filter: brightness(500%)`.

A mark is coloured only where the colour is the language's own and worth recognising without reading
(the linguist palette, darkened to clear 4.5:1 — see --z-mark-* in _tokens.scss). Prose, config and
shell scripts take --z-fg-subtle: colour that means nothing competes with the colour that does.
*/
const MARKS: Record<string, Mark | IconName> = {
  py: { label: 'py', kind: 'python' },
  ipynb: { label: 'ipy', kind: 'notebook' },
  json: { label: '{}', kind: 'json' },
  js: { label: 'js', kind: 'javascript' },
  mjs: { label: 'js', kind: 'javascript' },
  cjs: { label: 'js', kind: 'javascript' },
  ts: { label: 'ts', kind: 'typescript' },
  tsx: { label: 'tsx', kind: 'react' },
  jsx: { label: 'jsx', kind: 'react' },
  go: { label: 'go', kind: 'go' },
  mod: { label: 'go', kind: 'go' },
  sum: { label: 'go', kind: 'go' },
  c: { label: 'c', kind: 'c' },
  h: { label: 'c', kind: 'c' },
  cpp: { label: 'c++', kind: 'cpp' },
  cc: { label: 'c++', kind: 'cpp' },
  hpp: { label: 'c++', kind: 'cpp' },
  java: { label: 'jv', kind: 'java' },
  class: { label: 'jv', kind: 'java' },
  html: { label: '<>', kind: 'html' },
  htm: { label: '<>', kind: 'html' },
  // All three are stylesheets and the name says which; `scs` and `sas` are only truncations.
  css: { label: 'css', kind: 'css' },
  scss: { label: 'css', kind: 'css' },
  sass: { label: 'css', kind: 'css' },

  md: { label: 'md', kind: 'plain' },
  markdown: { label: 'md', kind: 'plain' },
  txt: { label: 'txt', kind: 'plain' },
  yml: { label: 'yml', kind: 'plain' },
  yaml: { label: 'yml', kind: 'plain' },
  toml: { label: 'tml', kind: 'plain' },
  cfg: { label: 'cfg', kind: 'plain' },
  ini: { label: 'cfg', kind: 'plain' },
  sh: { label: 'sh', kind: 'plain' },
  bash: { label: 'sh', kind: 'plain' },
  zsh: { label: 'sh', kind: 'plain' },
  // `.gitignore` splits to the extension `gitignore`; LICENSE and Makefile have none at all and are
  // matched on the whole name, lowercased.
  gitignore: { label: 'git', kind: 'plain' },
  gitattributes: { label: 'git', kind: 'plain' },
  license: { label: 'lic', kind: 'plain' },
  makefile: { label: 'mk', kind: 'plain' },
  dockerfile: { label: 'dk', kind: 'plain' },

  // Drawn rather than lettered: `img` in front of a file called `plot.png` says nothing twice.
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  ico: 'image',
  svg: 'image',
};

/** Exported for the tests, which check the table rather than the rendering. */
export function markFor(fileName: string): Mark | IconName {
  const extension = getFileExtension(fileName)?.toLowerCase();
  const baseName = fileName.split('/').pop()?.toLowerCase();
  return (
    (extension ? MARKS[extension] : undefined) ??
    (baseName ? MARKS[baseName] : undefined) ??
    // A type with no mark of its own, which is the case that has to stay quiet: there are more of
    // them than of anything else in a real project.
    'file'
  );
}

interface FileMarkProps {
  /** The file's name or path. A path is fine — only the last segment is looked at. */
  name: string;
  className?: string;
}

export default function FileMark({ name, className }: FileMarkProps) {
  const mark = markFor(name);
  if (typeof mark === 'string') {
    return <Icon name={mark} className={className} />;
  }

  const classNames = ['file-mark', `file-mark-${mark.kind}`];
  if (className !== undefined) {
    classNames.push(className);
  }
  // aria-hidden, because the file name it stands in front of already says the type.
  return (
    <span className={classNames.join(' ')} aria-hidden="true">
      {mark.label}
    </span>
  );
}
