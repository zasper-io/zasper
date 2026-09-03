/*
A file's whole life in the file browser: created from the banner, renamed with the keyboard, deleted
through the dialog that asks first.

The tree and the disk are asserted separately at every step. A row that says the right thing over a
file that was never touched is the failure this catches, and it is the one a mocked test cannot: every
frontend test of this panel answers its own api calls.
*/
import { existsSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { fileTree, inProject, openApp, renameBox, treeRow } from './helpers';

test('a notebook is created, renamed and deleted from the tree', async ({ page }) => {
  await openApp(page);

  await page.getByTitle('New notebook').click();

  // A create offers the rename straight away, so the name is a decision rather than a default nobody
  // meant to keep. Escape takes what the server chose.
  await expect(renameBox(page)).toHaveValue('Untitled.ipynb');
  await renameBox(page).press('Escape');

  await expect(treeRow(page, 'Untitled.ipynb')).toBeVisible();
  expect(existsSync(inProject('Untitled.ipynb'))).toBe(true);

  // F2 on the focused row, not a click: a click on a notebook opens it, and this journey is about the
  // tree. Focus is what the tree's keyboard acts on, so the row takes it first.
  await treeRow(page, 'Untitled.ipynb').focus();
  await page.keyboard.press('F2');
  await renameBox(page).fill('renamed.ipynb');
  await renameBox(page).press('Enter');

  await expect(treeRow(page, 'renamed.ipynb')).toBeVisible();
  await expect(treeRow(page, 'Untitled.ipynb')).toHaveCount(0);
  expect(existsSync(inProject('renamed.ipynb'))).toBe(true);
  expect(existsSync(inProject('Untitled.ipynb'))).toBe(false);

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
