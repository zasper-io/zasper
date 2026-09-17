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

/** Whatever names a control in a failure message: its label, or the text on it. */
async function describe(control: Locator): Promise<string> {
  const label = await control.getAttribute('aria-label');
  const text = (await control.textContent())?.trim();
  return label || text || (await control.evaluate((el) => el.className)) || 'unnamed';
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

/*
The topbar as the prototype draws it. Each number was a mismatch against the drawing that nothing but a
browser could see, and the even height is what puts both the mark and the search box on whole pixels.
*/
test('the topbar is the size the prototype draws', async ({ page }) => {
  await openApp(page);
  const box = async (selector: string) => {
    const found = await page.locator(selector).boundingBox();
    expect(found, `${selector} is not rendered`).not.toBeNull();
    return found!;
  };

  expect((await box('.topBar')).height).toBe(36);

  const search = await box('.openCommandPaletteButton');
  expect(search.height).toBe(22);
  expect(search.width).toBeLessThanOrEqual(420);
  expect(Number.isInteger(search.y)).toBe(true);

  const logo = await box('.zasperLogo');
  expect([logo.width, logo.height]).toEqual([71, 30]);
  expect(Number.isInteger(logo.y)).toBe(true);

  await expect(page.locator('.openCommandPaletteButton .hint')).toHaveText(/^(⌘K|Ctrl\+K)$/);
});

/*
The right of the topbar is one row: the sidebar toggle, the name, and the way out, on one centre line.
The name used to sit 2.4px below the button beside it, in a block that set it on its baseline, and every
box in it still had the right size — which is why this compares centres rather than sizes.
*/
test('the topbar name sits on the same line as its buttons', async ({ page }) => {
  await openApp(page);
  const centre = async (locator: Locator) => {
    const box = await locator.boundingBox();
    expect(box, 'not rendered').not.toBeNull();
    return box!.y + box!.height / 2;
  };

  const bar = await centre(page.locator('.topBar'));
  for (const control of [
    page.getByRole('button', { name: 'Toggle sidebar' }),
    page.locator('.topBar .userName'),
    page.getByRole('button', { name: 'Sign out' }),
  ]) {
    expect(Math.abs((await centre(control)) - bar)).toBeLessThanOrEqual(0.5);
  }
});

/*
A recent file's mark sits on its name's baseline, and a file with no mark gets an icon in the same 18px
slot, centred on the row. The palette's marks sat 2px high, centred beside text rather than on its line,
and an icon on the Launcher stood on the baseline and pushed its row taller — every box still the size
it should be, which is why this reads baselines and left edges.
*/
test('a recent file’s mark or icon lines up with its name', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const info = (await (await fetch('/api/info')).json()) as { directory: string };
    const files = [
      { path: 'analysis.ipynb', name: 'analysis.ipynb', type: 'notebook' },
      { path: 'data/table.csv', name: 'table.csv', type: 'file' },
      { path: 'notes.txt', name: 'notes.txt', type: 'file' },
    ];
    localStorage.setItem(
      'zasper.recent',
      JSON.stringify({ version: 1, directory: info.directory, files })
    );
  });
  await page.reload();

  const rowsLineUp = async (rows: Locator) => {
    await expect(rows).toHaveCount(3);
    const measured = await rows.evaluateAll((elements) =>
      elements.map((row) => {
        const rowBox = row.getBoundingClientRect();
        // A zero-size inline-block's top is the baseline of the line it is placed on.
        const baseline = (el: Element) => {
          const probe = document.createElement('span');
          probe.style.cssText = 'display:inline-block;width:0;height:0';
          el.appendChild(probe);
          const y = probe.getBoundingClientRect().top;
          probe.remove();
          return y;
        };
        const label = row.querySelector('.panel-row-label')!;
        const mark = row.querySelector('.file-mark');
        const icon = row.querySelector('.file-mark-icon');
        const iconBox = icon?.getBoundingClientRect();
        return {
          name: label.textContent,
          rowHeight: rowBox.height,
          labelLeft: label.getBoundingClientRect().left,
          markDrop: mark ? baseline(mark) - baseline(label) : 0,
          iconDrop: iconBox
            ? iconBox.top + iconBox.height / 2 - (rowBox.top + rowBox.height / 2)
            : 0,
        };
      })
    );
    for (const row of measured) {
      expect(row.rowHeight, `${row.name}: row height`).toBe(22);
      expect(
        Math.abs(row.labelLeft - measured[0].labelLeft),
        `${row.name}: left edge`
      ).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.markDrop), `${row.name}: mark off the baseline`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.iconDrop), `${row.name}: icon off centre`).toBeLessThanOrEqual(0.5);
    }
  };

  await rowsLineUp(page.locator('.launcher-recent .launcher-list .panel-row'));

  await page.locator('.openCommandPaletteButton').click();
  await rowsLineUp(
    page.locator('.palette .panel-row').filter({ has: page.locator('.panel-row-name') })
  );
});

/*
Hiding the sidebar leaves the rail, which is the way back: a rail click opens the sidebar on the panel it
names. The chord does the same as the button, so both are driven here.
*/
test('the sidebar hides from the topbar and comes back from the rail', async ({ page }) => {
  await openApp(page);
  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  const width = async () => (await page.locator('.sideBar').boundingBox())?.width ?? 0;
  expect(await width()).toBeGreaterThan(100);

  await toggle.click();
  await expect.poll(width).toBe(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.navigation-list')).toBeVisible();

  await page.getByRole('button', { name: 'Source control' }).click();
  await expect.poll(width).toBeGreaterThan(100);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('ControlOrMeta+B');
  await expect.poll(width).toBe(0);
  await page.keyboard.press('ControlOrMeta+B');
  await expect.poll(width).toBeGreaterThan(100);
});

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
  // differently on every OS: the notebook's cell-type picker in its toolbar against the pickers in the
  // Settings tab. The notebook is behind that tab by then, which the comparison does not mind — every
  // value read below is one the stylesheet sets, and a hidden element resolves it the same way.
  await page.locator('.navigation-list').getByRole('button', { name: 'Settings' }).click();
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
 * The cell the keyboard is in says so.
 *
 * Here for the same reason as the test below, and from a worse version of it: `.activeCell` set
 * `border-color` on the cell, while `.notebook-body .single-line` set `border: 2px solid transparent`
 * — two classes against one, so the transparent border won and the focused cell was marked in
 * nothing at all. Every unit test of the notebook passed, because which cell is focused is state
 * React holds and the class was on the right element the whole time; what no unit test can see is
 * that the class resolved to `rgba(0, 0, 0, 0)`.
 *
 * Read off one cell in both states rather than two cells in one, so what is asserted is the change
 * and not a difference between a markdown cell and a code cell.
 */
test('the focused cell is marked, and marking it does not move it', async ({ page }) => {
  await openApp(page);
  await openNotebook(page);

  const code = page.locator('.single-line').nth(1);
  const editor = code.locator('.cm-editor');
  const edges = () =>
    editor.evaluate((el) => {
      const style = getComputedStyle(el);
      return { left: style.borderLeftColor, top: style.borderTopColor };
    });

  /** The box, without its `y`: the cell above swaps its rendered markdown for its source when it
      takes focus, so where this cell sits down the page is not this test's business. */
  const size = async () => {
    const box = (await editor.boundingBox())!;
    return { x: box.x, width: box.width, height: box.height };
  };

  await editor.locator('.cm-content').click();
  await expect(code).toHaveClass(/activeCell/);
  const active = await edges();
  const box = await size();

  // The markdown cell above, which takes focus from the code cell without any of it landing in a
  // text editor.
  await page.locator('.single-line').first().click();
  await expect(code).not.toHaveClass(/activeCell/);
  const idle = await edges();

  // The accent, resolved through the page so the assertion names the token rather than a hex value
  // that eight themes disagree about.
  const accent = await page.locator('.notebook-body').evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--z-accent)';
    el.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });

  expect(active.left, 'the focused cell is not marked in the accent').toBe(accent);
  expect(idle.left, 'an unfocused cell is marked as though it were focused').not.toBe(accent);
  // The left edge only: a full accent border around a block of code reads as an error, and this is
  // what the prototype settled on.
  expect(active.top, 'the accent is drawn around the cell rather than down its left edge').toBe(
    idle.top
  );
  // And the same size on the same left edge, so taking focus does not shift the code under the
  // pointer: the accent replaces the 2px border's colour rather than adding to it.
  expect(await size()).toEqual(box);
});

/*
 * A rendered markdown cell is marked and inset like the code beside it.
 *
 * A markdown cell that has been rendered has no `.cm-editor`, so it carried none of the marking the
 * test above asserts: it was the one cell that could hold the keyboard and say nothing about it, which
 * only showed once Shift-Enter began landing on such cells in command mode. The same left edge is on
 * its prose box now, and with it the 12px that edge holds code away from its own border — so this
 * reads both, and the second half is what catches the edge being added without the room for it.
 */
test('a rendered markdown cell carries the same left edge, and the same inset, as code', async ({
  page,
}) => {
  await openApp(page);
  await openNotebook(page);

  const prose = page.locator('.single-line').first().locator('.cellEditor');
  const code = page.locator('.single-line').nth(1).locator('.cellEditor');

  // Focus the code cell first, so the markdown cell above is rendered rather than open for editing.
  await code.locator('.cm-content').click();
  await expect(prose.locator('.cm-editor')).toHaveCount(0);

  const accent = await page.locator('.notebook-body').evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--z-accent)';
    el.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });

  const idle = await prose.evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(idle, 'an unfocused markdown cell is marked as though it were focused').not.toBe(accent);

  // Clicking the prose selects the cell without opening it — a double-click is what opens it.
  await prose.click();
  await expect(page.locator('.single-line').first()).toHaveClass(/activeCell/);
  const active = await prose.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      left: style.borderLeftColor,
      width: style.borderLeftWidth,
      // The style rather than the colour: a border that is not drawn still reports a colour — the
      // element's own `color`, which is what this assertion read at first and what it is not about.
      top: style.borderTopStyle,
      radius: style.borderTopLeftRadius,
    };
  });

  expect(active.left, 'a focused markdown cell is not marked in the accent').toBe(accent);
  expect(active.width, "the edge is not the code box's own 2px").toBe('2px');
  expect(active.top, 'the accent is drawn around the prose rather than down its left edge').toBe(
    'none'
  );
  expect(active.radius, "the edge does not carry the code box's own radius").toBe('4px');

  // One left edge for the notebook: prose and code start at the same x, measured from the box each
  // sits in rather than from the pane, so the gutter's width is not part of the assertion.
  const textLeft = (box: typeof prose, inner: string) =>
    box.evaluate((el, selector) => {
      const text = el.querySelector(selector)!.getBoundingClientRect();
      return Math.round(text.left - el.getBoundingClientRect().left);
    }, inner);

  expect(await textLeft(prose, 'h1, h2, h3, p'), 'prose and code do not share a left edge').toBe(
    await textLeft(code, '.cm-content')
  );
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

/*
 * Help is a tab, opened from the foot of the rail.
 *
 * It was a modal that dimmed the window a shortcut is read in order to be used on. The button's place
 * is asserted as geometry: `margin-top: auto` on the wrong element is still a button on the rail.
 */
test('the rail opens Help as a tab, from the foot of the rail', async ({ page }) => {
  await openApp(page);

  const rail = page.locator('.navigation-list');
  const button = rail.getByLabel('Help');
  const railBox = await rail.boundingBox();
  const buttonBox = await button.boundingBox();
  expect(railBox, 'the rail has no box').not.toBeNull();
  expect(buttonBox, 'the Help button has no box').not.toBeNull();
  const gap = railBox!.y + railBox!.height - (buttonBox!.y + buttonBox!.height);
  expect(gap, 'Help is not at the foot of the rail').toBeLessThan(16);

  await button.click();
  await expect(page.locator('.tab.is-active', { hasText: 'Help' })).toBeVisible();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.getByPlaceholder('Filter shortcuts')).toBeFocused();

  // F1 reaches the same tab from inside a notebook cell, where a key with no modifier is typing.
  await openNotebook(page);
  await page.locator('.cellEditor .cm-content').first().click();
  await page.keyboard.press('F1');
  await expect(page.locator('.tab.is-active', { hasText: 'Help' })).toBeVisible();
});

/*
 * A chord reaches the Help tab as one <kbd> per key cap rather than the palette's joined string.
 * `Show All Commands` is registered by the Topbar, so it is there with nothing open, and its chord
 * is three caps.
 */
test('the Help tab draws each key of a shortcut as a key', async ({ page }) => {
  await openApp(page);
  await page.locator('.navigation-list').getByLabel('Help').click();

  const pane = page.locator('.help-tab-page');
  const row = pane.locator('.panel-row', { hasText: 'Show All Commands' }).first();
  await expect(row).toBeVisible();

  const caps = row.locator('.help-chord').first().locator('kbd');
  await expect(caps).toHaveCount(3);
  for (const cap of await caps.all()) {
    expect((await cap.innerText()).length, 'a cap is holding more than one key').toBeLessThan(6);
  }

  const edges = await caps.first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { top: style.borderTopWidth, bottom: style.borderBottomWidth };
  });
  expect(parseFloat(edges.bottom), 'the cap has no bottom edge to sit on').toBeGreaterThan(
    parseFloat(edges.top)
  );

  await pane.getByPlaceholder('Filter shortcuts').fill('zoom');
  await expect(row).toHaveCount(0);
  await expect(pane.locator('.panel-row', { hasText: 'Zoom In' })).toBeVisible();
});

/**
 * A rendered markdown cell is set in the app's own scale.
 *
 * The last thing Bootstrap was doing in this application, and the least visible: a markdown cell is the
 * one piece of prose whose tags carry no class — react-markdown emits bare `<h1>`, `<p>`, `<ul>` — so
 * `reboot` and `type` were its stylesheet. A `#` heading was drawn at 40px in a cell whose body text is
 * 14, from `calc(1.375rem + 1.5vw)`, which is a heading that resizes with the *window*.
 *
 * Replacing that is three rules in NotebookEditor.scss reading three tokens, and the reason this is a
 * browser test is the way the replacement failed first time round: the tokens did not exist yet, `h1`
 * fell back to the inherited 14px, and nothing anywhere said so — an undefined custom property is not a
 * broken build, a type error or a failed unit test. It is one screen where every heading is body text.
 *
 * So both halves are asserted: the heading *is* the title step, and it is *not* the body size.
 */
test("a rendered markdown cell is set in the app's own scale", async ({ page }) => {
  await openApp(page);
  await openNotebook(page);

  // A markdown cell shows its source while the keyboard is in it, and the first cell of the fixture
  // is the markdown one, so the notebook opens on the editor rather than the prose. Focusing the code
  // cell below is what renders it.
  await page.locator('.single-line').nth(1).locator('.cm-content').click();

  const markdown = page.locator('.zasper-markdown').first();
  await expect(markdown).toBeVisible();

  // A token resolved through the page, so the assertion names the step rather than a pixel value that
  // this file would then own a second copy of.
  const step = (token: string) =>
    markdown.evaluate((el, name) => {
      const probe = document.createElement('span');
      probe.style.fontSize = `var(${name})`;
      el.append(probe);
      const size = getComputedStyle(probe).fontSize;
      probe.remove();
      return size;
    }, token);

  const title = await step('--z-font-size-title');
  const body = await step('--z-font-size-body');

  const heading = await markdown
    .locator('h1')
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return { fontSize: style.fontSize, marginTop: style.marginTop };
    });

  expect(heading.fontSize, 'the heading is not the title step').toBe(title);
  expect(heading.fontSize, 'the heading is body text, so a token it reads is undefined').not.toBe(
    body
  );
  // The cell's own padding is the gap above it; `> :first-child` is what says so.
  expect(heading.marginTop, 'the first block in the cell is pushed down by a margin').toBe('0px');

  const paragraph = await markdown
    .locator('p')
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return { fontSize: style.fontSize, marginTop: style.marginTop };
    });

  expect(paragraph.fontSize, 'prose in a cell is not the body size').toBe(body);
  // A browser's own paragraph margin is 1em top *and* bottom. The app spaces prose downwards only,
  // which is what Bootstrap did here and the one part of it worth keeping.
  expect(paragraph.marginTop, 'the paragraph carries the browser default margin').toBe('0px');
});

/*
/login answers to its container rather than the window: #root carries the zoom, and a media query
cannot see it, so a zoomed-in login on a laptop-sized window never stacked.
*/
test('the login page zooms from the keyboard and stacks when zoomed in', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/login');

  const root = page.locator('#root');
  const loginPage = page.locator('.login-page');
  await expect(loginPage).toBeVisible();
  const columns = () =>
    loginPage.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(await columns()).toBe(2);

  for (let step = 0; step < 4; step++) {
    await page.keyboard.press('ControlOrMeta+=');
  }
  await expect(root).toHaveCSS('zoom', '2.0736');
  await expect.poll(columns).toBe(1);

  await page.keyboard.press('ControlOrMeta+0');
  await expect(root).toHaveCSS('zoom', '1');
  await expect.poll(columns).toBe(2);
});
