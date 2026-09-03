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
});
