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

test('a dialog keeps the keyboard until it is answered, then gives it back', async ({ page }) => {
  await openApp(page);
  const row = treeRow(page, 'notes.txt');
  await row.focus();

  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog');
  // Cancel, so the destructive answer is not one Enter away.
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

  // Round and round inside, never out into the IDE behind the backdrop.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[aria-modal]'))).toBe(true);
  }

  // A chord meant for the window does nothing behind it.
  await page.keyboard.press('Control+`');
  await expect(page.locator('.terminalArea')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("only the focused cell's controls are in the Tab order", async ({ page }) => {
  await openApp(page);
  await treeRow(page, 'analysis.ipynb').click();
  const picker = page.locator('.modal').filter({ hasText: 'Select Kernel' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.single-line')).toHaveCount(2);

  // Each gap's insert buttons and each cell's toolbar and run button used to be stops of their own,
  // about eight per cell before Tab reached anything past the notebook.
  const stray = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.notebook-body button, .notebook-body [tabindex]')]
      .filter((e) => e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled)
      .filter((e) => !e.closest('.activeCell') && !e.closest('.cell-insert.is-end'))
      .map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim() ?? e.className)
  );
  expect(stray).toEqual([]);
});
