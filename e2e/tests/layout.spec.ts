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

import { fileTree, openApp, treeRow } from './helpers';

/** Small, on purpose: this is the "did it render at all" threshold, not a design review. */
const MIN_SIZE = 8;

/**
 * The size an icon button is designed to be, which is the row it sits in. A different question from
 * MIN_SIZE above — that one asks whether a control rendered at all, this one asks whether it is the
 * size the styleguide says — and the reason it is asserted is that the rule was written down for a
 * year and kept nowhere: `.editor-button` was a reset, so every toolbar button was as big as its
 * glyph. The three deliberate departures each say so in the stylesheet and are excluded by name
 * below.
 */
const HIT_AREA = 22;

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
  //
  // Waited for rather than looked at. The dialog is rendered once the notebook has loaded, so an
  // `isVisible()` on the way past is false as often as not — and the dialog then opens over whatever
  // the test does next, which is how it reads as a click that never lands.
  const picker = page.locator('.modal').filter({ hasText: 'Select Kernel' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Close' }).click();
  await expect(picker).toHaveCount(0);
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

test('a rename box is the size of the row it is in', async ({ page }) => {
  await openApp(page);
  const before = await treeRow(page, 'notes.txt').locator('a').boundingBox();

  await treeRow(page, 'notes.txt').focus();
  await page.keyboard.press('F2');

  // Unstyled, the box took the browser's own font and padding and stood taller than the 22px row, so
  // renaming anything shoved every row below it down the panel.
  const box = page.locator('input.rowNameInput');
  await expect(box).toBeVisible();
  // The row is found by the box it now holds: while the box is open the row shows no name to find it by.
  const after = await fileTree(page).locator('a:has(input.rowNameInput)').boundingBox();
  expect(after!.height).toBe(before!.height);
  expect(await unclickable(box), 'the rename box').toEqual([]);

  // And inside the row, which is what keeps it inside the panel: the icon in front of it is what the
  // width has to leave room for.
  const field = await box.boundingBox();
  expect(Math.round(field!.x + field!.width)).toBeLessThanOrEqual(
    Math.round(after!.x + after!.width)
  );
});

test('every control in the notebook toolbar can be clicked', async ({ page }) => {
  await openApp(page);
  await openNotebook(page);

  expect(await unclickable(page.locator('.text-editor-tool button')), 'toolbar buttons').toEqual(
    []
  );
  expect(await unclickable(page.locator('.text-editor-tool select')), 'the cell type').toEqual([]);
});

test('every icon button is the size the styleguide says', async ({ page }) => {
  await openApp(page);
  await openNotebook(page);

  // Named exceptions, not a blanket allowance: the close cross on a tab is 18px so that it does not
  // set the strip's height, and a git sync arrow is 22px tall but wider when it carries a count.
  const buttons = page.locator('.z-icon-button:visible:not(.tab-close):not(.git-sync-action)');
  // The toolbars are on screen, so there is something to measure; a passing empty list would be the
  // failure mode of this test.
  expect(await buttons.count()).toBeGreaterThan(4);

  const undersized: string[] = [];
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    const name = await describe(button);
    if (box === null) {
      undersized.push(`${name}: not rendered`);
    } else if (Math.round(box.width) < HIT_AREA || Math.round(box.height) < HIT_AREA) {
      undersized.push(`${name}: ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
  }
  expect(undersized).toEqual([]);
});

/** The surface of a control: the four things that must not drift between two of them. */
function surfaces(controls: Locator): Promise<string[]> {
  return controls.evaluateAll((found) =>
    found.map((control) => {
      const style = getComputedStyle(control);
      return [style.backgroundColor, style.color, style.borderColor, style.borderRadius].join(' ');
    })
  );
}

test('every field is the same box', async ({ page }) => {
  await openApp(page);

  // What `.z-field` exists to answer for. Not the height: the tree's filter is deliberately 4px
  // shorter, and a commit message is as tall as it needs to be. What must not drift is the surface —
  // four separate statements of it are what this replaced, and the one that drifts is invisible until
  // somebody opens a dark theme and finds one white rectangle in the sidebar.
  //
  // Two panels, because the sidebar shows one at a time and the fields are in different ones: the
  // tree's filter here, the commit box after the click. Comparing across the two is the point — the
  // drift this catches is between stylesheets, and no view holds both.
  const boxes = await surfaces(page.locator('.treeFilter'));
  await page.getByLabel('Source control').click();
  await expect(page.locator('.commit-message-input')).toBeVisible();
  boxes.push(...(await surfaces(page.locator('.commit-message-input'))));

  expect(boxes.length).toBeGreaterThan(1);
  expect(new Set(boxes).size, boxes.join('\n')).toBe(1);
});

test('every select is the same box', async ({ page }) => {
  await openApp(page);
  await openNotebook(page);

  // The same question for `.z-select`, which is the app drawing a control the platform draws
  // differently on every OS. Both of these are on screen at once — the notebook's cell-type picker in
  // the editor, the theme picker in the sidebar — so the comparison is of what a user sees together.
  await page.getByLabel('Settings').click();
  await expect(page.locator('#settings-theme')).toBeVisible();

  const wrappers = page.locator('.z-select');
  expect(await wrappers.count()).toBeGreaterThan(1);

  // Read off both halves, because the control is two elements: the border and the radius belong to the
  // wrapper — the arrow has to sit inside them, which is why the wrapper exists — and the fill and the
  // ink belong to the <select>. Not the wrapper's `color`: it is inherited from whatever the control
  // was dropped into and nothing draws with it, so comparing it would fail on the toolbar's dimmed
  // chrome and mean nothing.
  //
  // `appearance` is in the list because it is the declaration this control went years without: with the
  // platform drawing its own arrow, the triangle beside it was decoration under an opaque background.
  const boxes = await wrappers.evaluateAll((found) =>
    found.map((wrapper) => {
      const box = getComputedStyle(wrapper);
      const select = getComputedStyle(wrapper.querySelector('select')!);
      return [
        box.borderColor,
        box.borderRadius,
        box.height,
        select.backgroundColor,
        select.color,
        select.appearance,
      ].join(' ');
    })
  );
  expect(new Set(boxes).size, boxes.join('\n')).toBe(1);
  expect(boxes[0]).toContain('none');
});

test('the tab bar and the notebook toolbar stay inside the content area', async ({ page }) => {
  await openApp(page);
  await openNotebook(page);

  for (const selector of ['.tabHeader', '.text-editor-tool']) {
    expect(await overflow(page.locator(selector)), `${selector} overflows`).toBeLessThanOrEqual(0);
  }
});

/*
 * A tab fills its strip, top and bottom.
 *
 * The vertical counterpart of the test above, and it is here because this went wrong unnoticed:
 * removing Bootstrap's `nav` partial took the box model out from under the tab strip, and what was
 * left was a 20px tab hanging from the top of a 30px bar with a band of bare chrome beneath it. Every
 * other assertion about the strip — its colours, its weights, its ellipsis — went on passing, because
 * each of them reads one tab and none of them reads it against the bar it sits in.
 */
test('every tab fills the height of the tab strip', async ({ page }) => {
  await openApp(page);
  await openNotebook(page);

  const strip = await page.locator('.tabHeader').boundingBox();
  const tabs = await page.locator('.tab').all();
  expect(tabs.length).toBeGreaterThan(1);
  for (const tab of tabs) {
    const name = (await tab.locator('.tabName').textContent()) ?? '';
    const box = await tab.boundingBox();
    expect(box!.y, `${name} does not start at the top of the strip`).toBeCloseTo(strip!.y, 0);
    expect(box!.y + box!.height, `${name} does not reach the bottom of the strip`).toBeCloseTo(
      strip!.y + strip!.height,
      0
    );
  }
});
