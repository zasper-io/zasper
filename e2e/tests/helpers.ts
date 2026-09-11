import { join } from 'node:path';

import { APIRequestContext, expect, Locator, Page, test as base } from '@playwright/test';

import { accessToken, projectDir } from '../paths';

/** The link the server opens on startup, which signs the page in on arrival. */
export const signInPath = `/?token=${accessToken}`;

/**
 * `test`, with a `request` that carries a session. Playwright's own cannot sign in, and every /api
 * route answers 401 without one.
 */
export const test = base.extend({
  request: async ({ playwright, baseURL }, use) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    const answer = await anonymous.post('/auth/login', { data: { accessToken } });
    expect(answer.ok(), 'the e2e access token was refused').toBeTruthy();
    const { token } = (await answer.json()) as { token: string };
    await anonymous.dispose();

    const request = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    await use(request);
    await request.dispose();
  },
});

/** Opens the app and waits until the file browser has something in it. */
export async function openApp(page: Page): Promise<void> {
  await page.goto(signInPath);
  await expect(fileTree(page)).toBeVisible();
}

export function fileTree(page: Page): Locator {
  return page.getByRole('tree', { name: 'Files' });
}

/**
 * A row in the file browser, by the name it shows.
 *
 * The row whose own link says the name, rather than every row containing it: a folder's row holds the
 * rows inside it, so a plain text match on an expanded folder matches the folder as well as the file.
 */
export function treeRow(page: Page, name: string): Locator {
  return fileTree(page)
    .getByRole('treeitem')
    .filter({ has: page.locator(':scope > a', { hasText: name }) });
}

/**
 * The rename box, which is a row's name replaced by an input. Not reached through its row: while it is
 * open the row shows no name, so there is nothing left to find the row by.
 */
export function renameBox(page: Page): Locator {
  return fileTree(page).getByRole('textbox');
}

/**
 * A button in the notebook's own toolbar, by its tooltip.
 *
 * Scoped to the toolbar because the focused cell's hover buttons name the same actions — "Run Cell"
 * on its own is the toolbar's button and the cell's, which are the same command from two places.
 */
export function toolbarButton(page: Page, title: string): Locator {
  return page.locator('.text-editor-tool').getByTitle(title);
}

/** A path inside the throwaway project, for the assertions that only disk can answer. */
export function inProject(...parts: string[]): string {
  return join(projectDir, ...parts);
}

/** What the server offers to start, so a spec that needs a kernel can skip instead of failing. */
export async function installedKernels(request: APIRequestContext): Promise<string[]> {
  const answer = await request.get('/api/kernelspecs');
  expect(answer.ok(), 'the kernelspecs could not be listed').toBeTruthy();

  const listed = (await answer.json()) as { kernelspecs?: Record<string, unknown> };
  return Object.keys(listed.kernelspecs ?? {});
}

export interface IFailures {
  /** Console errors and uncaught exceptions, which are the same thing to a reader of the console. */
  console: string[];
  /** Requests the server refused or could not answer. */
  requests: string[];
}

/**
 * Collects what a browser would show a developer in its console. Every spec runs the app for real, so
 * any of these is a defect somewhere even when the journey itself passed; the boot spec asserts on
 * them.
 */
export function watchForFailures(page: Page): IFailures {
  const failures: IFailures = { console: [], requests: [] };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      // With where it came from: a refused request logs "Failed to load resource" and nothing else,
      // and which resource that was is only in the location.
      const where = message.location().url;
      failures.console.push(where === '' ? message.text() : `${message.text()} (${where})`);
    }
  });
  page.on('pageerror', (error) => failures.console.push(`uncaught: ${error.message}`));
  page.on('response', (answer) => {
    if (answer.status() >= 400) {
      failures.requests.push(`${answer.status()} ${answer.request().method()} ${answer.url()}`);
    }
  });

  return failures;
}
