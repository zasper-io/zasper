/*
The tabs that were open come back when Zasper is opened again.

The check nothing below a browser can make: that the strip seeded from storage, the directory the
server reports and a real read of the file all agree. Asserted in parts, because each fails on its
own — the strip and its order, that only the tab in front has actually read itself, and that a
terminal is not among what comes back, a shell being unreattachable.
*/
import { Locator, Page, expect } from '@playwright/test';

import { openApp, test, treeRow, watchForFailures } from './helpers';

const FILE = 'notes.txt';
const NOTEBOOK = 'analysis.ipynb';

/** The names in the tab strip, in the order the strip has them. */
function tabNames(page: Page): Locator {
  return page.locator('.tab-item .tabName');
}

function tab(page: Page, name: string): Locator {
  return page.locator('.tab-item').filter({ hasText: name });
}

/**
 * Dismisses the kernel picker the fixture notebook raises, since it names no kernel.
 *
 * Dismissed rather than answered, as layout.spec.ts does it: a kernel would be a process to clean
 * up, and nothing here needs one. Waited for rather than looked at — the dialog opens once the
 * notebook has loaded, so an `isVisible()` on the way past is false as often as not, and it then
 * opens over whatever the test does next and reads as a click that never landed.
 */
async function dismissKernelPicker(page: Page): Promise<void> {
  const picker = page.locator('.modal').filter({ hasText: 'Select Kernel' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Close' }).click();
  await expect(picker).toHaveCount(0);
}

/** Opens a terminal, a file and a notebook, then puts the file back in front. */
async function openASession(page: Page): Promise<void> {
  await openApp(page);

  // The terminal first, while the Launcher is still the tab in front: its buttons live inside that
  // tab's own content, so there is nothing to click once a file is open over it.
  await page
    .locator('.launchSection')
    .filter({ hasText: 'Terminal' })
    .locator('.launcher-icon')
    .click();
  await expect(tab(page, 'Terminal 1')).toBeVisible();

  await treeRow(page, FILE).click();
  await expect(page.locator('.cm-content').first()).toContainText('A plain file');

  await treeRow(page, NOTEBOOK).click();
  await expect(page.getByText('Fixture notebook')).toBeVisible();
  await dismissKernelPicker(page);

  // The tab in front is deliberately not the last one opened: restoring the strip and restoring
  // which of them was in front are two different things to get wrong.
  await page.locator('.tab').filter({ hasText: FILE }).click();
  await expect(tab(page, FILE).locator('.tab.is-active')).toHaveCount(1);
}

test('the tabs that were open come back, in order, with the same one in front', async ({
  page,
}) => {
  await openASession(page);

  await page.reload();

  await expect(tabNames(page)).toHaveText(['Launcher', FILE, NOTEBOOK]);
  await expect(tab(page, FILE).locator('.tab.is-active')).toHaveCount(1);
  // The tab in front read itself, which is the half of the restore that happens at boot.
  await expect(page.locator('.cm-content').first()).toContainText('A plain file');
});

test('a restored tab reads itself the first time it is looked at', async ({ page }) => {
  await openASession(page);

  await page.reload();
  await expect(tabNames(page)).toHaveText(['Launcher', FILE, NOTEBOOK]);

  // Not read while it is behind: a session of notebooks must not start a kernel each at boot, and
  // this notebook would raise its kernel picker the moment it read itself.
  await expect(page.getByText('Fixture notebook')).toHaveCount(0);

  await page.locator('.tab').filter({ hasText: NOTEBOOK }).click();

  await expect(page.getByText('Fixture notebook')).toBeVisible();
  await dismissKernelPicker(page);
});

/*
A shell cannot be reattached: every connection to /ws/terminals spawns a new one, and its scrollback
is not kept. A restored terminal tab would be an empty shell wearing the old one's name — and that
name is what the Jupyter panel decides by, so the duplicate would confuse it too.
*/
test('a terminal is not among the tabs that come back', async ({ page }) => {
  await openASession(page);

  await page.reload();
  await expect(tabNames(page)).toHaveText(['Launcher', FILE, NOTEBOOK]);

  await expect(tab(page, 'Terminal 1')).toHaveCount(0);
});

test('coming back is quiet: nothing failed and nothing was logged', async ({ page }) => {
  const failures = watchForFailures(page);
  await openASession(page);

  await page.reload();
  await expect(tabNames(page)).toHaveText(['Launcher', FILE, NOTEBOOK]);
  await expect(page.locator('.cm-content').first()).toContainText('A plain file');

  expect(failures.console, 'the console should be clear').toEqual([]);
  expect(failures.requests, 'every request should have been answered').toEqual([]);
});
