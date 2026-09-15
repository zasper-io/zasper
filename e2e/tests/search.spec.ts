/*
Search across the project (story 18), through the real server: a word inside a file that is not open is
found, a pressed match opens the file at it, and a replace writes the file only once it is confirmed.

Unit tests mock the search API and cannot see the half that matters most here — the server walking the
project, streaming what it finds, and writing a file back.
*/
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

import { Page, expect, test } from '@playwright/test';

import { inProject, openApp } from './helpers';

const FILE = 'search-target.txt';

test.afterEach(() => {
  rmSync(inProject(FILE), { force: true });
});

/** Opens the panel from the rail and searches for `pattern`. */
async function search(page: Page, pattern: string): Promise<void> {
  await page
    .locator('.navigation-list')
    .getByRole('button', { name: 'Search', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill(pattern);
}

test('a word inside a file is found, and a pressed match opens the file at it', async ({
  page,
}) => {
  writeFileSync(inProject(FILE), 'first line\nthe quokka sleeps\n');
  await openApp(page);

  await search(page, 'quokka');

  await expect(page.locator('.search-summary')).toHaveText('1 result in 1 file');
  await page.locator('.search-match', { hasText: 'the quokka sleeps' }).click();

  // The editor's own find card, searching for what the panel searched for.
  const card = page.locator('.editor-pane:not(.is-hidden) .find-card');
  await expect(card.getByRole('textbox', { name: 'Find' })).toHaveValue('quokka');
  await expect(card.locator('.find-count')).toHaveText('1 of 1');
});

test('replace all writes a file that is not open, once it is confirmed', async ({ page }) => {
  writeFileSync(inProject(FILE), 'quokka one\nquokka two\n');
  await openApp(page);

  await search(page, 'quokka');
  await expect(page.locator('.search-summary')).toHaveText('2 results in 1 file');
  await page.getByRole('button', { name: 'Show replace' }).click();
  await page.getByRole('textbox', { name: 'Replace', exact: true }).fill('wombat');
  await expect(page.locator('.search-match ins').first()).toHaveText('wombat');

  await page.getByRole('button', { name: 'Replace all' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Replace 2 matches in 1 file?');
  // Nothing is written before the answer.
  expect(readFileSync(inProject(FILE), 'utf8')).toBe('quokka one\nquokka two\n');

  await dialog.getByRole('button', { name: 'Replace', exact: true }).click();

  await expect.poll(() => readFileSync(inProject(FILE), 'utf8')).toBe('wombat one\nwombat two\n');
  await expect(page.locator('.search-summary')).toHaveText(/^No results/);
});
