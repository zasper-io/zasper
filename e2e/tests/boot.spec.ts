/*
The app loads, and the project it was started in is what it shows.

Everything else here builds on this, so it is worth failing on its own: a bundle that does not load, a
route the server does not answer, or an api the frontend calls with the wrong shape all show up as an
empty tree and nothing else.
*/
import { expect, test } from '@playwright/test';

import { fileTree, treeRow, watchForFailures } from './helpers';

test('the project the server was started in is what the app shows', async ({ page }) => {
  const failures = watchForFailures(page);

  await page.goto('/');

  await expect(page.getByRole('img', { name: 'Zasper' })).toBeVisible();

  // The fixture, and nothing else: a throwaway copy of e2e/fixtures/project is what the server was
  // pointed at, so the exact count is worth asserting — a tree listing the repo would mean the
  // working directory did not take.
  await expect(fileTree(page)).toBeVisible();
  await expect(fileTree(page).getByRole('treeitem')).toHaveCount(3);
  for (const name of ['analysis.ipynb', 'data', 'notes.txt']) {
    await expect(treeRow(page, name)).toBeVisible();
  }

  // The folder in view is named, which is also how the trail says where the tree is rooted.
  // Case-insensitively: the trail is upper-cased by its stylesheet, and that is not what is under test.
  await expect(page.getByRole('navigation', { name: 'Folder in view' })).toContainText('project', {
    ignoreCase: true,
  });

  // With nothing open, the Launcher is the whole content area.
  await expect(page.locator('.LauncherArea')).toBeVisible();

  /*
   * Nothing in the console and nothing refused, except what a project that is not a git repository
   * already does: the Git panel asks for the branch, the uncommitted files and the commit graph on
   * boot even while it is hidden, and all three answer 500 rather than "there is no repository here".
   * Named rather than allowed in general, so anything else that starts failing fails this spec.
   */
  const known = /\/api\/(current-branch|uncommitted-files|commit-graph)/;
  expect(
    failures.console.filter((line) => !known.test(line)),
    'the console carried errors'
  ).toEqual([]);
  expect(
    failures.requests.filter((line) => !known.test(line)),
    'requests failed'
  ).toEqual([]);
});

test('a folder opens and its contents are listed', async ({ page }) => {
  await page.goto('/');

  await treeRow(page, 'data').click();

  await expect(treeRow(page, 'table.csv')).toBeVisible();
});
