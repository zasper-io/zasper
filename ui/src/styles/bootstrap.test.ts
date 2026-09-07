/*
Bootstrap is out, and this is what keeps it out.

It left in three stages — the components, then the layout and utility partials, then `root`, `reboot`
and `type` with the dependency itself — and each stage ended with someone measuring the screen to find
what the framework had been quietly deciding: a 1055 z-index under a palette at 9999, a #0d6efd link in
an orange theme, a pink `<code>`, a 40px `#` heading in a 14px cell, an 8px margin under a panel heading
that no stylesheet in this app had asked for. None of that failed a type check or a render test.

What can be checked cheaply is that it does not come back, which is one `npm install` away at any time.
So: the dependency, the import, the compiled output, and the class names in the markup.
*/
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'sass';
import { describe, expect, it } from 'vitest';

const UI = join(__dirname, '../..');
const SRC = join(__dirname, '..');

/**
 * The class names the app actually carried, plus the utilities anyone reaching for Bootstrap again would
 * reach for first. Deliberately a list and not the `.d-*`/`.m*-*` prefixes it looks like: `.modal-dialog`,
 * `.modal-content` and `.modal-body` are the app's own names in `_modal.scss` now, and a prefix test would
 * have to know that.
 */
const GONE = [
  'btn',
  'btn-primary',
  'btn-secondary',
  'btn-danger',
  'btn-sm',
  'btn-lg',
  'btn-close',
  'form-control',
  'form-select',
  'form-check',
  'form-check-input',
  'input-group',
  'list-unstyled',
  'list-inline',
  'lead',
  'card',
  'card-body',
  'alert',
  'alert-danger',
  'badge',
  'breadcrumb',
  'breadcrumb-item',
  'nav-link',
  'nav-item',
  'navbar',
  'container',
  'container-fluid',
  'row',
  'col',
  'd-none',
  'd-block',
  'd-flex',
  'mt-auto',
  'ms-auto',
  'me-auto',
  'text-center',
  'text-muted',
  'float-end',
];

function sourceFiles(dir: string, test: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path, test);
    }
    return test.test(entry) ? [path] : [];
  });
}

/** Every whitespace-separated token of every `className` in a file, including the ones inside a
 * template literal's `${cond ? 'a' : 'b'}`, which is how half the app's state classes are written. */
function classNames(source: string): string[] {
  const names: string[] = [];
  const attribute = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{((?:[^{}]|\{[^{}]*\})*)\})/g;
  for (const match of source.matchAll(attribute)) {
    const expression = match[1] ?? match[2] ?? match[3] ?? '';
    // In an expression the class names are the string literals; everything else is a condition.
    const literals = expression.match(/'[^']*'|"[^"]*"|`[^`]*`/g) ?? [expression];
    for (const literal of literals) {
      names.push(...literal.replace(/['"`]/g, ' ').split(/\s+/).filter(Boolean));
    }
  }
  return names;
}

describe('Bootstrap', () => {
  it('is not a dependency', () => {
    const manifest = JSON.parse(readFileSync(join(UI, 'package.json'), 'utf8'));
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('bootstrap');
    expect(Object.keys(manifest.devDependencies ?? {})).not.toContain('bootstrap');
    // The manifest can be edited without the tree being touched, so the lock file is the one that says
    // whether an install would still put it in node_modules.
    const lock = readFileSync(join(UI, 'package-lock.json'), 'utf8');
    expect(lock).not.toContain('node_modules/bootstrap');
  });

  it('is not imported by any stylesheet', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SRC, /\.(scss|css)$/)) {
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/^\s*@(?:import|use|forward)\b.*bootstrap/i.test(line)) {
            offenders.push(`${path.slice(SRC.length + 1)}:${index + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('leaves nothing of itself in the compiled stylesheet', () => {
    // The `@import` deprecation is the whole stylesheet's to answer, not this test's.
    const css = compile(join(SRC, 'styles/index.scss'), { silenceDeprecations: ['import'] }).css;

    // `root` emitted about 180 of these and `reboot` read them; nothing in src ever did.
    expect(css).not.toMatch(/--bs-/);
    // Its own components and utilities, as *rules* — a class name inside a comment is the record of
    // why a token exists and half these files carry one.
    expect(css).not.toMatch(/^\s*\.btn[\s,.:{]/m);
    expect(css).not.toMatch(/^\s*\.form-control[\s,.:{]/m);
    expect(css).not.toMatch(/^\s*\.list-unstyled[\s,.:{]/m);
    // The heading scale, which sized a `#` in a markdown cell against the *window*.
    expect(css).not.toMatch(/1\.375rem \+ 1\.5vw/);
  });

  it('has no class names left in the markup', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SRC, /\.tsx$/)) {
      for (const name of classNames(readFileSync(path, 'utf8'))) {
        if (GONE.includes(name)) {
          offenders.push(`${path.slice(SRC.length + 1)}  ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
