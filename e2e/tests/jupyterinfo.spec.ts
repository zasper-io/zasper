/*
A running kernel is named in the Jupyter info panel, and shut down from it.

The part no mock can reach. Every frontend test of this panel answers its own api calls, so none of them
can catch the two things this journey is here to keep fixed: a panel that lists what this browser tab
started rather than what the server is running — the defect it had, and one a reload makes visible — and
a "Shut down" that says so without the kernel process going anywhere. What the server thinks is read back
from `/api/kernels` at the end, because a panel with an empty list over a machine still running python is
exactly the failure a mock cannot see.
*/
import { APIRequestContext, Locator, Page, expect, test } from '@playwright/test';

import { installedKernels, openApp } from './helpers';

const NOTEBOOK = 'Untitled.ipynb';

/** The open panel, so a locator cannot match the file browser that is still mounted beside it. */
function panel(page: Page): Locator {
  return page.locator('.nav-content:not(.is-hidden)');
}

/** How many kernels the server is running, which is the only answer that counts here. */
async function runningKernels(request: APIRequestContext): Promise<number> {
  const running = (await (await request.get('/api/kernels')).json()) as unknown[];
  return running.length;
}

/**
 * What the one seeded kernelspec calls itself, asked of the server rather than assumed: prepare.cjs
 * copies in whichever Python kernelspec this machine has, and `Python 3 (ipykernel)` is only one of the
 * things that can be named.
 */
async function displayNameOf(request: APIRequestContext, name: string): Promise<string> {
  const listed = (await (await request.get('/api/kernelspecs')).json()) as {
    kernelspecs: Record<string, { spec: { display_name: string } }>;
  };
  return listed.kernelspecs[name].spec.display_name;
}

test.afterEach(async ({ request }) => {
  // Put the project back the way the other specs expect to find it, whatever this one got through. The
  // sessions go first: each one owns a kernel process that outlives the page.
  const sessions = (await (await request.get('/api/sessions')).json()) as Record<string, unknown>;
  for (const id of Object.keys(sessions)) {
    await request.delete(`/api/sessions/${id}`);
  }
  await request.delete('/api/contents', { data: { path: NOTEBOOK } });
});

test('a running kernel is named with its notebook, and shut down from the panel', async ({
  page,
  request,
}) => {
  const kernels = await installedKernels(request);
  test.skip(kernels.length === 0, 'no kernelspec is installed');
  const displayName = await displayNameOf(request, kernels[0]);

  await openApp(page);

  // The Launcher is the way into a notebook that names a kernel up front, so this starts a session
  // without anything having to be run in it.
  await page
    .locator('.launchSection')
    .filter({ hasText: 'Notebook' })
    .locator('.launcher-icon')
    .first()
    .click();
  await expect(page.getByTitle('Run Cell')).toBeVisible();

  // Starting a kernel takes seconds, and until it is up there is nothing for the panel to be right about.
  await expect.poll(() => runningKernels(request), { timeout: 60_000 }).toBe(1);

  /*
   * Reloaded before the panel is read, on purpose.
   *
   * This is the assertion the panel could not have passed before. Everything it listed came from atoms
   * this browser tab wrote when it started the kernel, so a reload emptied the panel while the kernel
   * went on running — and only a read of the server survives that.
   */
  await page.reload();
  await page.getByLabel('Jupyter info').click();
  const open = panel(page);

  const row = open.locator('.panel-row').filter({ hasText: NOTEBOOK });
  await expect(row.locator('.panel-row-label')).toHaveText(displayName);
  await expect(row.locator('.panel-row-meta')).toHaveText(NOTEBOOK);

  // Counted in the heading, and the list of what could be started stays folded: it is reference material.
  await expect(open.getByRole('button', { name: /Running kernels/ })).toContainText('1');
  await expect(open.getByRole('button', { name: /Available kernels/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  );

  // By title rather than by the display name spelled out, so what this machine's kernelspec is called is
  // not something the click has to know.
  await row.getByTitle(/^Shut down /).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(NOTEBOOK);
  await dialog.getByRole('button', { name: 'Shut down' }).click();

  // The row going is the panel's claim. The empty list is the server's, and it is the one worth having.
  await expect(row).toHaveCount(0);
  await expect(open.getByText('No kernels running.')).toBeVisible();
  await expect.poll(() => runningKernels(request)).toBe(0);
});
