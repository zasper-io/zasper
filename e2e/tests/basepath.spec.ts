/*
The app served under a path, as a hub serves one person's server: `zasper --base-url /user/prasun/`.

Everything the app loads and asks for has to stay under that path: its scripts and styles, its API
calls, its websockets, its sign-in page and its cookie. A single address built from the root would go
to whatever the hub serves there, which is someone else's server or nothing, so the spec watches every
request rather than trusting that the screens it checks happened to use the right ones.
*/
import { expect, Page, test } from '@playwright/test';

import { accessToken, basePath, basePathURL, projectDir } from '../paths';
import { fileTree, openTerminal, treeRow, watchForFailures } from './helpers';

const origin = new URL(basePathURL).origin;

/** Every request the page made to this server outside its base path. */
function watchForStrays(page: Page): string[] {
  const strays: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    // A blob: URL has this server's origin too, but is the page's own memory, not a request to it.
    if (
      url.protocol.startsWith('http') &&
      url.origin === origin &&
      !url.pathname.startsWith(basePath)
    ) {
      strays.push(url.pathname);
    }
  });
  return strays;
}

test('the app, its API, its websockets and its sign-in stay under the base path', async ({
  page,
  context,
}) => {
  const failures = watchForFailures(page);
  const strays = watchForStrays(page);

  await page.goto(`${basePathURL}?token=${accessToken}`);

  await expect(fileTree(page)).toBeVisible();
  for (const name of ['analysis.ipynb', 'data', 'notes.txt']) {
    await expect(treeRow(page, name)).toBeVisible();
  }
  // The token is taken back out of the address bar, which stays at the base path.
  expect(new URL(page.url()).pathname).toBe(basePath);

  // The cookie is the base path's alone, so another server on the same host never receives it.
  const cookies = await context.cookies();
  expect(cookies.map((cookie) => cookie.path)).toEqual([basePath]);

  // A terminal is a websocket, under the base path like everything else.
  await openTerminal(page);
  const screen = page.locator('.terminalArea');
  await expect(async () => {
    await screen.click();
    await page.keyboard.type('pwd\n');
    await expect(page.locator('.xterm-rows')).toContainText(projectDir, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });

  // Without a session, the IDE sends the browser to the sign-in page under the base path.
  await context.clearCookies();
  await page.goto(basePathURL);
  await expect(page).toHaveURL(`${basePathURL}login`);
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

  expect(strays, 'requests went outside the base path').toEqual([]);
  expect(failures.console, 'the console carried errors').toEqual([]);
  expect(failures.requests, 'requests failed').toEqual([]);
});

test('nothing is served outside the base path, and the path without its slash gets one', async ({
  request,
}) => {
  for (const path of ['/', '/api/health', '/login', '/user/prasunanand/']) {
    const answer = await request.get(origin + path, { maxRedirects: 0 });
    expect(answer.status(), path).toBe(404);
  }

  const bare = await request.get(`${origin}${basePath.replace(/\/$/, '')}`, { maxRedirects: 0 });
  expect(bare.status()).toBe(301);
  expect(bare.headers()['location']).toBe(basePath);
});
