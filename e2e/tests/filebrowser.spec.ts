/*
A file's whole life in the file browser: created from the banner and named in the box that opens empty,
renamed with the keyboard, deleted through the dialog that asks first.

The tree and the disk are asserted separately at every step. A row that says the right thing over a
file that was never touched is the failure this catches, and it is the one a mocked test cannot: every
frontend test of this panel answers its own api calls.
*/
import { existsSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { fileTree, inProject, openApp, renameBox, treeRow } from './helpers';

test('a notebook is created, renamed and deleted from the tree', async ({ page }) => {
  await openApp(page);

  await page.getByLabel('New notebook').click();

  // A create asks for the name straight away, and asks with an empty box: `Untitled.ipynb` is what is
  // on disk, shown greyed as the placeholder, not something to select and type over.
  await expect(renameBox(page)).toHaveValue('');
  await expect(renameBox(page)).toHaveAttribute('placeholder', 'Untitled.ipynb');
  // Without the extension, which a notebook gets anyway: nothing that opens one knows it by anything
  // else, so `work` here would be a notebook that will not open as one.
  await renameBox(page).fill('work');
  await renameBox(page).press('Enter');

  await expect(treeRow(page, 'work.ipynb')).toBeVisible();
  expect(existsSync(inProject('work.ipynb'))).toBe(true);
  // Nothing named after nobody's default is left behind.
  expect(existsSync(inProject('Untitled.ipynb'))).toBe(false);

  // F2 on the focused row, not a click: a click on a notebook opens it, and this journey is about the
  // tree. Focus is what the tree's keyboard acts on, so the row takes it first.
  await treeRow(page, 'work.ipynb').focus();
  await page.keyboard.press('F2');
  // F2 still offers the name there is: this is an edit of something named, not a naming.
  await expect(renameBox(page)).toHaveValue('work.ipynb');
  await renameBox(page).fill('renamed.ipynb');
  await renameBox(page).press('Enter');

  await expect(treeRow(page, 'renamed.ipynb')).toBeVisible();
  await expect(treeRow(page, 'work.ipynb')).toHaveCount(0);
  expect(existsSync(inProject('renamed.ipynb'))).toBe(true);
  expect(existsSync(inProject('work.ipynb'))).toBe(false);

  await treeRow(page, 'renamed.ipynb').focus();
  await page.keyboard.press('Delete');

  // Asked before anything goes: there is no undo and no trash.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('renamed.ipynb');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(treeRow(page, 'renamed.ipynb')).toHaveCount(0);
  expect(existsSync(inProject('renamed.ipynb'))).toBe(false);
});

test('a delete that is cancelled leaves the file alone', async ({ page }) => {
  await openApp(page);

  await treeRow(page, 'notes.txt').focus();
  await page.keyboard.press('Delete');

  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(treeRow(page, 'notes.txt')).toBeVisible();
  expect(existsSync(inProject('notes.txt'))).toBe(true);
});

/*
The overlay family's dismissal rule, in the one place it was broken: a row's menu and its delete dialog
are rendered inside the row, and the tree's own Escape used to clear the selection and then stop the key
before the window listener that closes them ever saw it.

Written as an e2e test as well as a mocked one because the case that hid it is where the focus is. A
right-click leaves the focus on the row rather than in the menu, which is a thing a browser does and a
fireEvent does not.
*/
test('Escape closes a row menu and a dialog, and the backdrop closes nothing', async ({ page }) => {
  await openApp(page);

  await treeRow(page, 'notes.txt').click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await treeRow(page, 'notes.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // A dialog is a question, so it keeps its answer: a press on the backdrop is not one.
  await page.mouse.click(60, 820);
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(existsSync(inProject('notes.txt'))).toBe(true);
});

test('the filter hides the rows that do not match, and nothing else', async ({ page }) => {
  await openApp(page);

  await page.getByLabel('Filter files').fill('notes');

  await expect(treeRow(page, 'notes.txt')).toBeVisible();
  await expect(fileTree(page).getByRole('treeitem')).toHaveCount(1);

  // A filter is a view, not an edit: what it hid is still there.
  expect(existsSync(inProject('analysis.ipynb'))).toBe(true);

  await page.getByLabel('Filter files').fill('');
  await expect(fileTree(page).getByRole('treeitem')).toHaveCount(3);
});
