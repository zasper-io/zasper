/*
The command palette opens on its chord, filters, and running a command from it changes the app.

A real key press through a real browser, which is the part no unit test reaches: the palette's tests
render the component and call its handlers, and the dispatcher's tests build synthetic KeyboardEvents.
Neither would notice that the chord never arrives at the window.
*/
import { Page, expect, test } from '@playwright/test';

import { openApp } from './helpers';

const palette = '.palette-input';

/**
 * Control rather than Meta, on every platform: the chord is registered both as `Mod-Shift-p` and as
 * `Ctrl-Shift-p`, so Control is the one spelling that works on a mac and on CI alike.
 */
async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  await expect(page.locator(palette)).toBeFocused();
}

test('a command run from the palette changes the app', async ({ page }) => {
  await openApp(page);

  // The font size is on the content area as a class, which is what makes this command's effect
  // something a test can see at all.
  const content = page.locator('.main-content');
  await expect(content).toHaveClass(/zfont-14/);

  await openPalette(page);
  await page.locator(palette).fill('increase font');

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
  // per-component: the font sizes come from useAppCommands, the palettes from the Topbar itself.
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
