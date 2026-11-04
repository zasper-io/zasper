/*
The keyboard alone gets everywhere, and out again.

A terminal keeps Tab and Escape for the shell, and a code editor keeps Tab for indenting, so the only
proof that neither is a trap is a real xterm and a real CodeMirror under real key presses. F6 is the way
out of both (ui/src/ide/regions.ts); this is where that is held.
*/
import { Page, expect, test } from '@playwright/test';

import { openApp, openTerminal, treeRow } from './helpers';

/** Which part of the window has the focus, by its `data-region`; empty outside all of them. */
function focusedRegion(page: Page): Promise<string> {
  return page.evaluate(
    () => document.activeElement?.closest<HTMLElement>('[data-region]')?.dataset.region ?? ''
  );
}

test('F6 leaves the terminal, and Shift-F6 comes back to it', async ({ page }) => {
  await openApp(page);
  await openTerminal(page);
  const shell = page.locator('.xterm-helper-textarea').last();
  await shell.focus();

  // What a keyboard user tries first. The shell gets both, which is right, and the focus stays.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(shell).toBeFocused();

  await page.keyboard.press('F6');
  await expect.poll(() => focusedRegion(page)).toBe('rail');

  await page.keyboard.press('Shift+F6');
  await expect(shell).toBeFocused();
});

test('F6 leaves a code editor, and comes back to where the caret was', async ({ page }) => {
  await openApp(page);
  await treeRow(page, 'notes.txt').click();
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await expect.poll(() => focusedRegion(page)).toBe('editor');

  await page.keyboard.press('F6');
  await expect.poll(() => focusedRegion(page)).not.toBe('editor');

  await page.keyboard.press('Shift+F6');
  await expect(editor).toBeFocused();
});
