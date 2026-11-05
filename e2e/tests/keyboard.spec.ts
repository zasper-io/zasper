/*
The keyboard alone gets everywhere, and out again.

A terminal keeps Tab and Escape for the shell, and a code editor keeps Tab for indenting, so the only
proof that neither is a trap is a real xterm and a real CodeMirror under real key presses. F6 is the way
out of both (ui/src/ide/regions.ts); this is where that is held.
*/
import { Page, expect } from '@playwright/test';

import { installedKernels, openApp, openTerminal, test, treeRow } from './helpers';

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

/** Presses `key` until `reached` says the focus has arrived, at most `limit` times. */
async function pressUntil(page: Page, key: string, reached: () => Promise<boolean>, limit = 10) {
  for (let i = 0; i < limit && !(await reached()); i++) {
    await page.keyboard.press(key);
  }
  expect(await reached(), `${key} did not get there in ${limit}`).toBe(true);
}

/** The focused element's accessible name, as far as aria-label or its text goes. */
function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    return e === null || e === document.body
      ? ''
      : (e.getAttribute('aria-label') ?? e.textContent ?? '');
  });
}

// Phase 0's journey: from a fresh load to a cell that has run and a dialog answered, by keyboard alone,
// and after every step the focus is somewhere that says where the user is.
test('the keyboard alone opens a notebook, runs a cell, runs a command and answers it', async ({
  page,
  request,
}) => {
  test.skip((await installedKernels(request)).length === 0, 'no kernelspec is installed');
  await openApp(page);

  // Into the sidebar, then down its controls to the tree.
  await page.keyboard.press('Shift+F6');
  await expect.poll(() => focusedRegion(page)).toBe('sidebar');
  const onRow = () =>
    page.evaluate(() => document.activeElement?.getAttribute('role') === 'treeitem');
  await pressUntil(page, 'Tab', onRow);

  // Along the tree to the notebook, and open it.
  const notebook = treeRow(page, 'analysis.ipynb');
  await pressUntil(page, 'ArrowDown', () =>
    notebook.evaluate((row) => row === document.activeElement)
  );
  await page.keyboard.press('Enter');

  // The notebook names no kernel, so it asks for one, with the focus already in the question.
  const picker = page.getByRole('dialog').filter({ hasText: 'Select Kernel' });
  await expect(picker).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[aria-modal]')))
    .toBe(true);
  await pressUntil(page, 'Tab', async () => (await focusedName(page)).trim() === 'Select Kernel');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(notebook).toBeFocused();

  // F6 to the editor: the tab in front, not the first tab on the strip.
  await page.keyboard.press('F6');
  await expect(page.getByRole('tab', { selected: true })).toBeFocused();

  // Down into the notebook's cells, which a cell's own box takes in command mode.
  const onCell = () =>
    page.evaluate(() => !!document.activeElement?.hasAttribute('data-command-mode'));
  await pressUntil(page, 'Tab', onCell);
  await page.keyboard.press('ArrowDown');
  const codeCell = page.getByRole('group', { name: /^Cell 2, code/ });
  await expect(codeCell).toBeFocused();

  // Enter edits it; Ctrl-Enter runs it, again until the kernel has started.
  await page.keyboard.press('Enter');
  const source = page.getByRole('textbox', { name: 'Source of cell 2' });
  await expect(source).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('print(6 * 7)');
  await expect(async () => {
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.inner-text').filter({ hasText: '42' })).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 60_000 });
  await expect(source).toBeFocused();
  // And said, for whoever cannot see the count appear.
  await expect(page.locator('[role="status"]', { hasText: 'Cell 2 finished' })).toHaveCount(1);

  // Escape leaves the cell for its box, in one press.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: /^Cell 2, code/ })).toBeFocused();

  // The palette, a command that asks first, and Escape back to the cell the command was about.
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('combobox', { name: 'Search files and commands' })).toBeFocused();
  await page.keyboard.type('Restart Kernel');
  // The row the field points at, once the list has narrowed to it.
  const results = page.getByRole('listbox', { name: 'Results' });
  await expect(results.getByRole('option', { selected: true })).toContainText('Restart Kernel');
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[aria-modal]')))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('group', { name: /^Cell 2, code/ })).toBeFocused();

  const sessions = (await (await request.get('/api/sessions')).json()) as Record<string, unknown>;
  for (const id of Object.keys(sessions)) {
    await request.delete(`/api/sessions/${id}`);
  }
});
