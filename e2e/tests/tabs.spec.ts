/*
Closing a tab with unsaved work asks first, and each of the three answers does what it says.

The prompt is the only thing standing between a stray click on a tab's × and lost work, so all three
branches are worth a test: the one that keeps the tab, the one that throws the edit away, and the one
that writes it. What the file holds afterwards is read from disk — "Save" that closed the tab without
writing would pass every assertion made on screen.
*/
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

import { Locator, Page, expect, test } from '@playwright/test';

import { inProject, openApp, treeRow } from './helpers';

const FILE = 'notes.txt';
/** What fixtures/project/notes.txt holds, restored after every test that changes it. */
const ORIGINAL = 'A plain file, so the tree has something in it that is not a notebook.\n';
const EDITED = 'edited by the tabs spec';

function tab(page: Page, name: string): Locator {
  return page.locator('.tab-item').filter({ hasText: name });
}

/** The × on a tab. A span rather than a button: a button cannot nest in the tab's own button. */
function closeButton(page: Page, name: string): Locator {
  return tab(page, name).locator('.tab-close');
}

/**
 * Opens the file and replaces everything in it, without saving.
 *
 * Select-all then type, so the file's contents afterwards are known exactly rather than being the
 * fixture with something appended wherever the click happened to land the cursor.
 */
async function openAndEdit(page: Page): Promise<void> {
  await openApp(page);
  await treeRow(page, FILE).click();

  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('A plain file');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(EDITED);
  await expect(editor).toHaveText(EDITED);
}

test.afterEach(() => {
  writeFileSync(inProject(FILE), ORIGINAL);
});

test('cancelling the prompt keeps the tab and the edit', async ({ page }) => {
  await openAndEdit(page);

  await closeButton(page, FILE).click();

  const prompt = page.getByRole('dialog');
  await expect(prompt).toContainText('Unsaved changes');
  await expect(prompt).toContainText(FILE);
  await prompt.getByRole('button', { name: 'Cancel' }).click();

  await expect(prompt).toHaveCount(0);
  await expect(tab(page, FILE)).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveText(EDITED);
  expect(readFileSync(inProject(FILE), 'utf8')).toBe(ORIGINAL);
});

test('discarding closes the tab and leaves the file as it was', async ({ page }) => {
  await openAndEdit(page);

  await closeButton(page, FILE).click();
  await page.getByRole('dialog').getByRole('button', { name: "Don't Save" }).click();

  await expect(tab(page, FILE)).toHaveCount(0);
  expect(readFileSync(inProject(FILE), 'utf8')).toBe(ORIGINAL);

  // And the work really is gone rather than held somewhere: reopening shows the file, not the edit.
  await treeRow(page, FILE).click();
  await expect(page.locator('.cm-content')).toContainText('A plain file');
});

test('Save writes the file and then closes the tab', async ({ page }) => {
  await openAndEdit(page);

  await closeButton(page, FILE).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();

  await expect(tab(page, FILE)).toHaveCount(0);
  // Polled, because the tab closes on the write's reply and the reply arrives before the assertion
  // would otherwise have anything to read.
  await expect
    .poll(() => readFileSync(inProject(FILE), 'utf8'), {
      message: 'the save did not reach the file',
    })
    .toBe(EDITED);
});

test.describe('closing several tabs', () => {
  const SECOND = 'second.txt';

  test.beforeEach(() => {
    writeFileSync(inProject(SECOND), 'A second file.\n');
  });

  test.afterEach(() => {
    rmSync(inProject(SECOND), { force: true });
  });

  /** Opens a file from the tree and replaces what it holds, without saving. */
  async function editFile(page: Page, name: string, loaded: string, text: string): Promise<void> {
    await treeRow(page, name).click();
    const editor = page.locator('.cm-content:visible');
    await expect(editor).toContainText(loaded);
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(text);
    await expect(editor).toHaveText(text);
  }

  test('Close All asks once about every unsaved file, and Save All writes each', async ({
    page,
  }) => {
    await openApp(page);
    await editFile(page, FILE, 'A plain file', EDITED);
    await editFile(page, SECOND, 'A second file', 'second, edited');

    await tab(page, SECOND).locator('.tab').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Close All/ }).click();

    const prompt = page.getByRole('dialog');
    await expect(prompt).toContainText('these 2 files');
    await expect(prompt.getByRole('listitem')).toHaveText([/notes\.txt/, /second\.txt/]);
    await prompt.getByRole('button', { name: 'Save All' }).click();

    await expect(page.locator('.tab-item')).toHaveCount(1);
    await expect.poll(() => readFileSync(inProject(FILE), 'utf8')).toBe(EDITED);
    await expect.poll(() => readFileSync(inProject(SECOND), 'utf8')).toBe('second, edited');
  });

  test('Alt+Shift+W closes every tab but the Launcher', async ({ page }) => {
    await openApp(page);
    await treeRow(page, FILE).click();
    await treeRow(page, SECOND).click();
    await expect(page.locator('.tab-item')).toHaveCount(3);

    await page.keyboard.press('Alt+Shift+W');

    await expect(page.locator('.tab-item')).toHaveCount(1);
  });
});

test('a tab with nothing unsaved closes without asking', async ({ page }) => {
  await openApp(page);
  await treeRow(page, FILE).click();
  await expect(page.locator('.cm-content')).toContainText('A plain file');

  await closeButton(page, FILE).click();

  await expect(tab(page, FILE)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
