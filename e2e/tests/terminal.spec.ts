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
