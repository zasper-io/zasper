/*
The palette opens on its chord, filters, and running a command from it changes the app. One query
reaches both a command and a file, which is the half of the merge no mock can check: the file section
comes from a walk of the project on the server.

A real key press through a real browser, which is the part no unit test reaches: the palette's tests
render the component and call its handlers, and the dispatcher's tests build synthetic KeyboardEvents.
Neither would notice that the chord never arrives at the window.
*/
import { rmSync, writeFileSync } from 'node:fs';

import { Page, expect, test } from '@playwright/test';

import { inProject, openApp } from './helpers';

const palette = '.palette-input';

/**
 * Opens the palette on the commands chord, which arrives with `>` already in the field.
 *
 * Control rather than Meta, on every platform: the chord is registered both as `Mod-Shift-p` and as
 * `Ctrl-Shift-p`, so Control is the one spelling that works on a mac and on CI alike.
 */
async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  await expect(page.locator(palette)).toBeFocused();
  await expect(page.locator(palette)).toHaveValue('>');
}

test('a command run from the palette changes the app', async ({ page }) => {
  await openApp(page);

  // The font size is on the content area as a class, which is what makes this command's effect
  // something a test can see at all.
  const content = page.locator('.main-content');
  await expect(content).toHaveClass(/zfont-14/);

  await openPalette(page);
  // The `>` kept, so the list is commands and nothing else — what Enter runs then does not depend on
  // what the project happens to be called.
  await page.locator(palette).fill('>increase font');

  const matches = page.locator('.palette-item');
  await expect(matches).toHaveCount(1);
  await expect(matches).toContainText('Increase Font Size');

  // No arrowing first: the first match is selected as soon as it is the first match.
  await page.locator(palette).press('Enter');

  await expect(page.locator(palette)).toHaveCount(0);
  await expect(content).toHaveClass(/zfont-16/);
});

test('the palette lists what is registered, and Escape dismisses it', async ({ page }) => {
  await openApp(page);
  await openPalette(page);

  // Commands from more than one place, so this fails if a registry that should be shared has become
  // per-component: the font sizes come from useAppCommands, the two ways into the palette from the
  // Topbar itself. Uncapped, because `>` alone is the browse-the-whole-registry view.
  for (const label of ['Increase Font Size', 'Decrease Font Size', 'Go to File']) {
    await expect(page.locator('.palette-item').filter({ hasText: label })).toHaveCount(1);
  }

  await page.locator(palette).fill('no such command exists');
  await expect(page.locator('.palette-item')).toHaveCount(0);
  // Enter with nothing selected does nothing at all, rather than running whatever was selected before
  // the query narrowed past it.
  await page.locator(palette).press('Enter');
  await expect(page.locator(palette)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator(palette)).toHaveCount(0);
});

test('one query answers with both a command and a file, and opens the file', async ({ page }) => {
  /*
   * A file named after a word that is also in a command label, which is the only way to see both
   * sections at once. Written here rather than seeded into fixtures/project, which every spec shares:
   * a file whose name is a command word would be a trap in the other specs' way.
   */
  const file = 'increase.md';
  writeFileSync(inProject(file), '# increase\n');

  try {
    await openApp(page);
    await openPalette(page);
    // The `>` gone, so this is the query the topbar's search box would send.
    await page.locator(palette).fill('increase');

    await expect(page.locator('.palette-heading')).toHaveText(['Commands', 'Files']);
    await expect(
      page.locator('.palette-item').filter({ hasText: 'Increase Font Size' })
    ).toHaveCount(1);
    await expect(page.locator('.palette-item').filter({ hasText: file })).toHaveCount(1);

    // One command matches, so the second row is the file: Enter on it opens the file rather than
    // running the command above it.
    await page.locator(palette).press('ArrowDown');
    await page.locator(palette).press('Enter');

    await expect(page.locator(palette)).toHaveCount(0);
    await expect(page.locator('.tabHeader .nav-link', { hasText: file })).toHaveCount(1);
  } finally {
    rmSync(inProject(file), { force: true });
  }
});
