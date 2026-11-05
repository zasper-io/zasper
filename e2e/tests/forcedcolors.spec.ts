/*
Windows High Contrast, as Chromium emulates it. A forced palette replaces every author colour but a
system colour, so a state that was only a fill is gone, and nothing in the light and dark themes says
so. These are read back as computed colours, which are the forced ones.
*/
import { Locator, expect, test } from '@playwright/test';

import { openApp, treeRow } from './helpers';

function fill(element: Locator): Promise<string> {
  return element.evaluate((e) => getComputedStyle(e).backgroundColor);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
});

test('the open file and its tab still stand out from the rest', async ({ page }) => {
  await openApp(page);
  await treeRow(page, 'notes.txt').locator(':scope > a').click();

  const open = treeRow(page, 'notes.txt').locator(':scope > a');
  const other = treeRow(page, 'analysis.ipynb').locator(':scope > a');
  await expect(open).toHaveClass(/\bactive\b/);
  // Polled: a row's fill is transitioned, and starts from the Canvas every other row is.
  await expect.poll(() => fill(open)).not.toBe(await fill(other));

  const active = page.getByRole('tab', { selected: true });
  const inactive = page.getByRole('tab', { selected: false }).first();
  await expect(active).toHaveText(/notes\.txt/);
  await expect.poll(() => fill(active)).not.toBe(await fill(inactive));
});

test('a dialog keeps an edge, and its answers keep their words', async ({ page }) => {
  await openApp(page);
  await treeRow(page, 'notes.txt').focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const box = dialog.locator('.modal-content');
  const edge = await box.evaluate((e) => {
    const style = getComputedStyle(e);
    return {
      width: style.borderTopWidth,
      color: style.borderTopColor,
      fill: style.backgroundColor,
    };
  });
  expect(edge.width).toBe('1px');
  expect(edge.color).not.toBe(edge.fill);

  // Each button's words in a different colour from its own fill: the red one's fill is the palette's,
  // and the ink it had for that red was not.
  for (const button of await dialog.locator('.z-button').all()) {
    const { ink, own } = await button.evaluate((e) => ({
      ink: getComputedStyle(e).color,
      own: getComputedStyle(e).backgroundColor,
    }));
    expect(ink, await button.innerText()).not.toBe(own);
  }
  await page.keyboard.press('Escape');
});
