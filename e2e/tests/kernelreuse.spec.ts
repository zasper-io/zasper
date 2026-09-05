/*
Closing a notebook's tab leaves its kernel running, and reopening the notebook plugs back into the
session it was on — what JupyterLab does, and what a long-running computation depends on.

Only a real server can answer this: the kernel is a process, the session is the server's record of it,
and the thing being asserted is that reopening a notebook does *not* start a second one. The proof that
it is the same kernel and not a fresh one on the same file is `x` — set before the tab was closed, and
still there afterwards.
*/
import { readFileSync } from 'node:fs';

import { APIRequestContext, expect, Page, test } from '@playwright/test';

import { fileTree, inProject, installedKernels, openApp, treeRow } from './helpers';

const NOTEBOOK = 'Untitled.ipynb';

/** The kernels the server has running, by id. */
async function runningKernelIds(request: APIRequestContext): Promise<string[]> {
  const answer = await request.get('/api/kernels');
  expect(answer.ok(), 'the kernels could not be listed').toBeTruthy();

  const running = (await answer.json()) as { id: string }[];
  return running.map((kernel) => kernel.id);
}

/** Whether the save reached the file, which is what makes closing the tab ask nothing. */
function savedCellCount(): number {
  try {
    return JSON.parse(readFileSync(inProject(NOTEBOOK), 'utf8')).cells.length;
  } catch {
    return 0;
  }
}

/**
 * Runs the focused cell until its answer arrives.
 *
 * The click is part of what is retried because starting a kernel takes seconds and a request sent
 * before the socket is open goes nowhere — there is no queue behind it. Retrying is safe: both cells
 * here are questions, and asking one twice gives the same answer.
 */
async function runUntilAnswered(page: Page, cell: number, answer: string): Promise<void> {
  const output = page.locator('.single-line').nth(cell).locator('.inner-text');
  await expect(async () => {
    await page.getByTitle('Run Cell').click();
    await expect(output).toContainText(answer, { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

test.afterEach(async ({ request }) => {
  // The sessions first: each owns a kernel process, and this spec's whole point is that closing a tab
  // does not stop one.
  const sessions = (await (await request.get('/api/sessions')).json()) as Record<string, unknown>;
  for (const id of Object.keys(sessions)) {
    await request.delete(`/api/sessions/${id}`);
  }
  await request.delete('/api/contents', { data: { path: NOTEBOOK } });
});

test('a closed notebook keeps its kernel, and reopening it joins the same session', async ({
  page,
  request,
}) => {
  const kernels = await installedKernels(request);
  test.skip(kernels.length === 0, 'no kernelspec is installed');

  await openApp(page);

  await page
    .locator('.launchSection')
    .filter({ hasText: 'Notebook' })
    .locator('.launcher-icon')
    .first()
    .click();
  await expect(page.getByTitle('Run Cell')).toBeVisible();

  const editor = page.locator('.cellEditor .cm-content').first();
  await editor.click();
  await page.keyboard.type('x = 41; x');
  await runUntilAnswered(page, 0, '41');

  // Saved before the tab is closed, so the close is a close rather than an answer to the unsaved-work
  // prompt.
  await page.getByTitle('Save Notebook').click();
  await expect
    .poll(savedCellCount, { message: 'the save did not reach the file' })
    .toBeGreaterThan(0);

  const [started] = await runningKernelIds(request);
  expect(started, 'the notebook did not start a kernel').toBeTruthy();

  const tab = page.locator('.tabHeader .nav-link', { hasText: NOTEBOOK });
  await tab.locator('.fa-times-circle').click();
  await expect(tab).toHaveCount(0);

  /*
   * A wait rather than a poll, because what is being asserted is that nothing happens. Killing the
   * kernel was the first thing the close did before, and a poll would pass on the first read taken
   * before the request it is meant to catch had even been sent.
   */
  await page.waitForTimeout(1_500);
  expect(await runningKernelIds(request), 'closing the tab killed the kernel').toEqual([started]);

  await treeRow(page, NOTEBOOK).click();
  await expect(page.getByTitle('Run Cell')).toBeVisible();
  // The session answers which kernel this notebook is on, so there is nothing to ask about.
  await expect(page.getByText('Select Kernel')).toHaveCount(0);
  expect(await runningKernelIds(request), 'reopening started a second kernel').toEqual([started]);

  // And it is the same kernel in the sense that matters: `x` was set in a tab that no longer exists.
  await page.locator('.cellEditor .cm-content').first().click();
  await page.getByTitle('Add Cell Below').click();
  const second = page.locator('.cellEditor .cm-content').nth(1);
  await second.click();
  await page.keyboard.type('x + 1');
  await runUntilAnswered(page, 1, '42');

  /*
   * A reload is the other way back to a notebook whose kernel is still running, and the harder one: the
   * page has forgotten every kernel it ever started, so the server's sessions are all there is to go on.
   * Another cell, because the output of the first was saved into the file and would be there whether a
   * kernel answered or not.
   */
  await page.reload();
  await expect(fileTree(page)).toBeVisible();
  await treeRow(page, NOTEBOOK).click();
  await expect(page.getByTitle('Run Cell')).toBeVisible();

  await page.locator('.cellEditor .cm-content').first().click();
  await page.getByTitle('Add Cell Below').click();
  await page.locator('.cellEditor .cm-content').nth(1).click();
  await page.keyboard.type('x + 2');
  await runUntilAnswered(page, 1, '43');

  expect(await runningKernelIds(request), 'a reload started a second kernel').toEqual([started]);
});
