import { join } from 'node:path';

import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

import { projectDir } from '../paths';

/** Opens the app and waits until the file browser has something in it. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
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
