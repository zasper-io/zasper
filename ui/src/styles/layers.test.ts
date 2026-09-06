/*
The stack, which is the one part of the overlay family that cannot check itself.

Five z-indexes picked independently is exactly the kind of thing that comes back: before this file the
palette was 9999 and a toast was 9999 too, so which of them won was DOM order; a dialog was Bootstrap's
1055, *under* both; the two menus were 1000; and .searchIcon in Topbar.scss was 10000 — above every other
thing in the application — to keep one magnifier over two stacked fields.

None of that failed a type check, a lint or a render test. It failed by putting a dialog behind the
palette that opened it, which only a person looking at the screen notices. So the invariant is asserted
against the stylesheets themselves: the four tokens exist and ascend, and nothing in src states a stacking
number in their range without going through them.
*/
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/** In stacking order, lowest first. A menu is opened *from* something; a toast is the only overlay
 * nobody asked for, so it is the only one that can arrive while another is open. */
const LAYERS = ['--z-layer-menu', '--z-layer-palette', '--z-layer-dialog', '--z-layer-toast'];

/**
 * Where a stacking number starts being a claim about the whole window rather than about two boxes inside
 * one component. Below it are the local ones — a sticky table head over its own rows, a login page's
 * hero over its own gradient, xterm's canvases over each other — and those are none of this file's
 * business.
 */
const WINDOW_SCALE = 1000;

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return stylesheets(path);
    }
    return /\.(scss|css)$/.test(entry) ? [path] : [];
  });
}

const tokens = readFileSync(join(SRC, 'styles/_tokens.scss'), 'utf8');

describe('the overlay stack', () => {
  it('declares the four layers once each, and in order', () => {
    const values = LAYERS.map((name) => {
      const match = new RegExp(`^\\s*${name}:\\s*(\\d+);`, 'm').exec(tokens);
      expect(match, name).not.toBeNull();
      return Number(match?.[1]);
    });

    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(LAYERS.length);
  });

  it('keeps them out of the themes, because what floats over what is not a colour', () => {
    // Every layer is declared exactly once in the whole file: a `[data-theme]` block restating one
    // would mean the stack changed with the theme.
    for (const name of LAYERS) {
      const occurrences = tokens.split(`${name}:`).length - 1;
      expect(occurrences, name).toBe(1);
    }
  });

  it('is the only way a stylesheet claims a place in the window', () => {
    const offenders: string[] = [];

    for (const path of stylesheets(SRC)) {
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, index) => {
        // Declarations only. A comment saying what a number *used* to be is the record of why these
        // tokens exist, and half the files here carry one.
        const match = /^\s*z-index:\s*([^;]+);/.exec(line);
        if (match === null) {
          return;
        }
        const value = match[1].trim();
        const literal = Number(value);
        if (Number.isFinite(literal) && Math.abs(literal) < WINDOW_SCALE) {
          return;
        }
        if (LAYERS.some((name) => value.includes(name))) {
          return;
        }
        offenders.push(`${path.slice(SRC.length + 1)}:${index + 1}  z-index: ${value}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
