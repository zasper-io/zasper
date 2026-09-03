/*
Every control on screen is big enough to click, and nothing spills out of the box it is in.

This is the spec for the class of bug that ended the last redesign: a 150px-square SVG in a narrow flex
row rendered the banner's New notebook button 0px wide. The button was in the DOM, it had its title,
its click handler worked when dispatched — every unit test passed, because jsdom has no layout.

Measurement, deliberately, and not screenshots. There are no reference images here and nothing that
fails when a font is updated or a colour changes; what is asserted is only what a user could not work
around: a control with no area, and a row wider than the panel holding it.
*/
import { Locator, Page, expect, test } from '@playwright/test';

import { openApp, treeRow } from './helpers';

/** Small, on purpose: this is the "did it render at all" threshold, not a design review. */
const MIN_SIZE = 8;

/** Whatever names a control in a failure message: its title, its label, or the text on it. */
async function describe(control: Locator): Promise<string> {
  const title = await control.getAttribute('title');
  const label = await control.getAttribute('aria-label');
  const text = (await control.textContent())?.trim();
  return title || label || text || (await control.evaluate((el) => el.className)) || 'unnamed';
}

/** The controls that are not big enough to be clicked, named — the whole list, not the first. */
async function unclickable(controls: Locator): Promise<string[]> {
  const found: string[] = [];
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    const name = await describe(control);
    if (box === null) {
      found.push(`${name}: not rendered`);
    } else if (box.width < MIN_SIZE || box.height < MIN_SIZE) {
      found.push(`${name}: ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
  }
  return found;
}

/** How far the contents of a row reach past its right edge, in pixels. */
function overflow(row: Locator): Promise<number> {
  return row.evaluate((el) => el.scrollWidth - el.clientWidth);
}

/** Opens the fixture notebook without starting a kernel, which the toolbar does not need. */
async function openNotebook(page: Page): Promise<void> {
  await treeRow(page, 'analysis.ipynb').click();

  // A notebook that names no kernel asks which one to use. Dismissed rather than answered: a kernel
  // would be a process to clean up, and the toolbar is on screen either way.
  const picker = page.locator('.modal').filter({ hasText: 'Select Kernel' });
  if (await picker.isVisible()) {
    await picker.getByRole('button', { name: 'Close' }).click();
  }
  await expect(page.locator('.text-editor-tool')).toBeVisible();
}

test('every control in the file browser can be clicked', async ({ page }) => {
  await openApp(page);

  expect(await unclickable(page.locator('.projectButtons button')), 'banner buttons').toEqual([]);
  expect(await unclickable(page.locator('.treeToolbar button')), 'toolbar buttons').toEqual([]);
  expect(await unclickable(page.locator('.treeFilter')), 'the filter box').toEqual([]);
});

test('nothing in the file browser is wider than the file browser', async ({ page }) => {
  await openApp(page);

  // The two rows above the tree, which is where the controls are packed tightest.
  for (const selector of ['.projectBanner', '.treeToolbar']) {
    expect(await overflow(page.locator(selector)), `${selector} overflows`).toBeLessThanOrEqual(0);
  }

  // And the panel itself, so a row that pushed the sidebar wide rather than clipping is caught too.
  const sidebar = await page.locator('.sideBar').boundingBox();
  expect(sidebar).not.toBeNull();
  for (const row of await page.locator('.projectBanner, .treeToolbar').all()) {
    const box = await row.boundingBox();
    expect(box, await describe(row)).not.toBeNull();
    // Rounded: sub-pixel widths are a fact of flex layout and not a bug.
    expect(Math.round(box!.x + box!.width)).toBeLessThanOrEqual(
      Math.round(sidebar!.x + sidebar!.width)
    );
  }
});

test('every control in the notebook toolbar can be clicked', async ({ page }) => {
  await openApp(page);
  await openNotebook(page);

  expect(await unclickable(page.locator('.text-editor-tool button')), 'toolbar buttons').toEqual(
    []
  );
  expect(await unclickable(page.locator('.text-editor-tool select')), 'the cell type').toEqual([]);
});

test('the tab bar and the notebook toolbar stay inside the content area', async ({ page }) => {
  await openApp(page);
  await openNotebook(page);

  for (const selector of ['.tabHeader', '.text-editor-tool']) {
    expect(await overflow(page.locator(selector)), `${selector} overflows`).toBeLessThanOrEqual(0);
  }
});
