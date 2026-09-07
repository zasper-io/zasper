/*
A terminal opens, and the shell behind it is a real shell in the project directory.

The websocket, the pty and xterm are all real here, and none of them is covered anywhere else from the
browser's side: the Go test for the handler speaks to it without a terminal emulator, and there is no
frontend test of this component at all. `pwd` is chosen because the answer is a fact the test knows —
a shell started in the wrong directory is a defect that looks like nothing until it deletes something.
*/
import { expect, test } from '@playwright/test';

import { projectDir } from '../paths';
import { openApp } from './helpers';

test('a terminal opens a shell in the project directory', async ({ page }) => {
  await openApp(page);

  await page
    .locator('.launchSection')
    .filter({ hasText: 'Terminal' })
    .locator('.launcher-icon')
    .click();

  const screen = page.locator('.terminalArea');
  await expect(screen).toBeVisible();
  await expect(page.locator('.tab-item').filter({ hasText: 'Terminal 1' })).toBeVisible();

  /*
   * Asked again until it is answered, for the same reason the first notebook run is: what is typed
   * before the socket opens is typed into a terminal with nothing on the other end of it, and there
   * is no queue to hold it. `pwd` is safe to repeat — the worst case is a screen with the answer on
   * it twice.
   */
  const rows = page.locator('.xterm-rows');
  await expect(async () => {
    await screen.click();
    await page.keyboard.type('pwd\n');
    await expect(rows).toContainText(projectDir, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });

  /*
   * The sixteen ANSI colours, in the same terminal because the socket is now known to be open.
   *
   * This is the only place they can be read back at all: xterm is handed a JavaScript object at
   * construction rather than reading CSS, so a slot spelled the way a token is spelled — `brightBlack`
   * against `bright-black` — is a colour that silently stays xterm's own. `ui/src/ide/terminal/
   * theme.test.ts` checks the sixteen names; this checks that they reach the screen.
   *
   * And it checks the decision, which is what the values below are: the terminal takes the palette for a
   * *dark* surface in every theme, because it is the one panel that stays dark in a light window. This
   * suite's default theme is teal-light, where --z-ansi-black everywhere else in the app is #000000 —
   * black ink on --a-900, which is a program printing into the dark.
   */
  await page.keyboard.type("printf 'ink \\033[31mIN-RED\\033[0m \\033[30mIN-BLACK\\033[0m\\n'\n");
  const printed = 'ink IN-RED IN-BLACK';
  await expect(rows).toContainText(printed);

  /*
   * Read by colour rather than by span, because how many spans a row is drawn with is xterm's business
   * and not a contract: this row comes back as `IN` `-` `RED` when the output arrives in more than one
   * frame, and as `IN-RED` when it does not. Asserting on one span's exact text passed while this spec
   * ran alone and failed behind any other, which is a test measuring the renderer's mood. Grouping the
   * row's text by computed colour asks the question the decision actually turns on — which characters
   * came out red — and gets the same answer either way.
   */
  const inked = await rows.evaluate((node, line) => {
    const row = [...node.querySelectorAll(':scope > div')].find(
      (r) => r.textContent?.trim() === line
    );
    const byColour: Record<string, string> = {};
    for (const span of row?.querySelectorAll('span') ?? []) {
      const colour = getComputedStyle(span).color;
      byColour[colour] = (byColour[colour] ?? '') + span.textContent;
    }
    return byColour;
  }, printed);
  expect(inked['rgb(225, 131, 131)']).toBe('IN-RED');
  expect(inked['rgb(158, 158, 158)']).toBe('IN-BLACK');

  const declared = (selector: string) =>
    page
      .locator(selector)
      .evaluate((node) => getComputedStyle(node).getPropertyValue('--z-ansi-black').trim());
  expect(await declared('.terminalContainer')).toBe('#9e9e9e');
  expect(await declared('html')).toBe('#000000');
});

/*
The grid follows the pane, and the shell is told what the grid actually is.

Both halves were wrong and the symptom of each was a scrollbar in a terminal nobody had scrolled.
xterm's FitAddon measures the pane with getComputedStyle, so fitting one that has no layout box read
`100%` as 100 pixels — and every tab in this app stays mounted with the inactive ones `display: none`,
so a single window resize behind another tab collapsed the terminal to five rows for good. The row
count then went out to the pty with one added to it, which is a shell painting its last line into a
row that does not exist.

Only a browser can see any of this: there is no frontend test of the component, and the Go handler
test speaks to the socket without a terminal emulator on the other end.
*/
test('the terminal fits its pane, including after a resize it was not on screen for', async ({
  page,
}) => {
  await openApp(page);
  await page
    .locator('.launchSection')
    .filter({ hasText: 'Terminal' })
    .locator('.launcher-icon')
    .click();

  const area = page.locator('.terminalArea');
  await expect(area).toBeVisible();
  // The pane is on screen before the grid is: nothing is opened until `document.fonts.ready` settles,
  // because xterm measures a character once and a font that arrives afterwards would leave every fit
  // dividing the pane by a height nothing is drawn at.
  await expect(area.locator('.xterm-screen')).toBeVisible();

  const geometry = () =>
    area.evaluate((node) => {
      const viewport = node.querySelector('.xterm-viewport') as HTMLElement;
      const screen = node.querySelector('.xterm-screen') as HTMLElement;
      const rows = node.querySelectorAll('.xterm-rows > div').length;
      const screenHeight = Math.round(screen.getBoundingClientRect().height);
      return {
        paneHeight: node.clientHeight,
        screenHeight,
        rows,
        cellHeight: rows === 0 ? 0 : screenHeight / rows,
        scrollable: viewport.scrollHeight > viewport.clientHeight,
      };
    });

  // Fills the pane to within one row and never past it, which is the same statement as "the number of
  // rows is right" without depending on a font's metrics.
  const fitsThePane = async () => {
    const box = await geometry();
    expect(box.rows, 'no rows drawn').toBeGreaterThan(1);
    expect(box.screenHeight, 'the grid is taller than the pane holding it').toBeLessThanOrEqual(
      box.paneHeight
    );
    expect(box.paneHeight - box.screenHeight, 'the grid is smaller than its pane').toBeLessThan(
      box.cellHeight
    );
    expect(box.scrollable, 'a terminal nobody has scrolled can be scrolled').toBe(false);
    return box;
  };

  const opened = await fitsThePane();

  await page.locator('.tab').filter({ hasText: 'Launcher' }).click();
  await page.setViewportSize({ width: 1100, height: 620 });
  await page.locator('.tab').filter({ hasText: 'Terminal 1' }).click();
  await expect(area).toBeVisible();

  // Retried: the refit is a ResizeObserver callback, so it lands a frame after the tab does.
  await expect(async () => {
    const back = await geometry();
    expect(back.paneHeight, 'the pane did not change size').not.toBe(opened.paneHeight);
    expect(back.rows, 'the grid did not follow the pane').not.toBe(opened.rows);
  }).toPass({ timeout: 10_000 });
  const resized = await fitsThePane();

  // What the shell believes, which is the only side of the size message this suite can read. Asked
  // until answered, as `pwd` above is, and for the same reason.
  const rows = page.locator('.xterm-rows');
  await expect(async () => {
    await area.click();
    await page.keyboard.type('echo lines=$(tput lines)\n');
    await expect(rows).toContainText(`lines=${resized.rows}`, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
});

/*
The scrollbar on the terminal is the terminal's, and Cmd +/- resizes the shell's text with the code's.

Both are only true in a browser. The scrollbar the user sees belongs to `.xterm-viewport`, an element
the app never names and xterm gives `overflow-y: scroll` on purpose, so its gutter is always laid out:
with the app's tokens it drew a white stripe down a near-black terminal. `scrollbar-color` inherits its
*computed* value, which means the pair had already been substituted at `:root` — a fact no unit test
can see and the reason `.terminalContainer` has to repeat the declaration. And the font size lands on a
canvas: the element's `font-size` is only half of it, the other half being xterm re-measuring the
character and handing the pty fewer rows.
*/
test('the terminal owns its scrollbar and its text size follows the app', async ({ page }) => {
  await openApp(page);
  await page
    .locator('.launchSection')
    .filter({ hasText: 'Terminal' })
    .locator('.launcher-icon')
    .click();

  const area = page.locator('.terminalArea');
  await expect(area.locator('.xterm-screen')).toBeVisible();

  // The viewport rather than the container: it is the element that scrolls, and it is xterm's, so this
  // fails if the repeated declaration is dropped or the tokens stop reaching what the app does not name.
  const viewport = area.locator('.xterm-viewport');
  const painted = await viewport.evaluate((node) => {
    const container = node.closest('.terminalContainer') as HTMLElement;
    const style = getComputedStyle(node);
    return {
      scrollbar: style.scrollbarColor,
      width: style.scrollbarWidth,
      surface: getComputedStyle(container).backgroundColor,
      app: getComputedStyle(document.documentElement).scrollbarColor,
    };
  });

  // Two colours, thumb then track, and the track is the surface it is drawn on — which is the whole
  // decision: the terminal stays dark in a light window, so it cannot take the app's white track.
  const [thumb, track] = painted.scrollbar.match(/\w+\([^)]*\)/g) ?? [];
  expect(track, 'the track is not the terminal surface').toBe(painted.surface);
  expect(thumb, 'the thumb is the track, so nothing is visible').not.toBe(painted.surface);
  expect(painted.scrollbar, 'the terminal took the app scrollbar').not.toBe(painted.app);
  // `scrollbar-width` does not inherit, so this is only thin if it is declared somewhere that reaches
  // an element the app never names.
  expect(painted.width).toBe('thin');

  const cell = () =>
    area.evaluate((node) => {
      const screen = node.querySelector('.xterm-screen') as HTMLElement;
      const rows = node.querySelectorAll('.xterm-rows > div').length;
      return {
        rows,
        element: parseFloat(getComputedStyle(node.closest('.terminalContainer')!).fontSize),
        cellHeight: screen.getBoundingClientRect().height / rows,
      };
    });
  const before = await cell();

  // Through the palette, as palette.spec.ts runs it: the chord itself is `Mod-=`, which is a different
  // key on a mac and on CI, and what is under test here is the terminal rather than the binding.
  for (let step = 0; step < 2; step += 1) {
    await page.keyboard.press('Control+Shift+P');
    await page.locator('.palette-input').fill('>increase font');
    await page.locator('.palette-input').press('Enter');
  }
  await expect(page.locator('.main-content')).toHaveClass(/zfont-18/);

  // Retried: the canvas is re-measured and refitted from an effect, a frame behind the class.
  await expect(async () => {
    const after = await cell();
    expect(after.element, 'the box did not take the new size').toBeGreaterThan(before.element);
    expect(after.cellHeight, 'the canvas is still drawn at the old size').toBeGreaterThan(
      before.cellHeight
    );
    expect(after.rows, 'a taller cell in the same pane must be fewer rows').toBeLessThan(
      before.rows
    );
  }).toPass({ timeout: 10_000 });
  const zoomed = await cell();

  const rows = page.locator('.xterm-rows');
  await expect(async () => {
    await area.click();
    await page.keyboard.type('echo lines=$(tput lines)\n');
    await expect(rows).toContainText(`lines=${zoomed.rows}`, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
});
