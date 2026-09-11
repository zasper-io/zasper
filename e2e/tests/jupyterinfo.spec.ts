/*
A running kernel is named in the Jupyter info panel, and shut down from it.

The part no mock can reach. Every frontend test of this panel answers its own api calls, so none of them
can catch the two things this journey is here to keep fixed: a panel that lists what this browser tab
started rather than what the server is running — the defect it had, and one a reload makes visible — and
a "Shut down" that says so without the kernel process going anywhere. What the server thinks is read back
from `/api/kernels` at the end, because a panel with an empty list over a machine still running python is
exactly the failure a mock cannot see.
*/
import { APIRequestContext, Locator, Page, expect } from '@playwright/test';

import { installedKernels, openApp, test, toolbarButton } from './helpers';

const NOTEBOOK = 'Untitled.ipynb';

/** The open panel, so a locator cannot match the file browser that is still mounted beside it. */
function panel(page: Page): Locator {
  return page.locator('.nav-content:not(.is-hidden)');
}

/** A kernel as the server reports it: the three fields it used to declare and never write. */
interface KernelModel {
  id: string;
  name: string;
  execution_state: string;
  last_activity: string;
  connections: number;
}

async function kernelModels(request: APIRequestContext): Promise<KernelModel[]> {
  return (await (await request.get('/api/kernels')).json()) as KernelModel[];
}

/** How many kernels the server is running, which is the only answer that counts here. */
async function runningKernels(request: APIRequestContext): Promise<number> {
  return (await kernelModels(request)).length;
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
  await expect(toolbarButton(page, 'Run Cell')).toBeVisible();

  // Starting a kernel takes seconds, and until it is up there is nothing for the panel to be right about.
  await expect.poll(() => runningKernels(request), { timeout: 60_000 }).toBe(1);

  // The notebook's socket, counted. The three fields below were declared and never written, so this and
  // the two after the reload are the assertions that the server answers with anything at all.
  await expect
    .poll(async () => (await kernelModels(request))[0].connections, { timeout: 30_000 })
    .toBe(1);

  /*
   * Reloaded before the panel is read, on purpose.
   *
   * This is the assertion the panel could not have passed before. Everything it listed came from atoms
   * this browser tab wrote when it started the kernel, so a reload emptied the panel while the kernel
   * went on running — and only a read of the server survives that.
   */
  await page.reload();

  /*
   * The client the kernel had is gone with the page that held it, and the kernel is not: `connections`
   * back to 0 is the server noticing, which nothing used to do — a closed tab left its connection in the
   * store forever, polling a kernel with nobody to forward to.
   */
  await expect.poll(async () => (await kernelModels(request))[0].connections).toBe(0);

  /*
   * Idle, with nothing attached to have heard it say so. The server keeps its own subscription to every
   * kernel it runs, which is what makes this answerable at all — and `idle` rather than "whatever the
   * kernel last published" is the assertion on purpose: leaving it to the client connections is what left
   * a kernel reported busy forever, on the `busy` of a request whose `idle` arrived after the tab had
   * closed. Polled because it is the kernel that decides when to say it.
   */
  await expect.poll(async () => (await kernelModels(request))[0].execution_state).toBe('idle');
  const model = (await kernelModels(request))[0];
  expect(Number.isNaN(Date.parse(model.last_activity))).toBe(false);

  await page.getByLabel('Jupyter info').click();
  const open = panel(page);

  const row = open.locator('.panel-row').filter({ hasText: NOTEBOOK });
  await expect(row.locator('.panel-row-label')).toHaveText(displayName);
  await expect(row.locator('.panel-row-meta')).toHaveText(NOTEBOOK);

  // Both from the server alone: this window has never been attached to this kernel, so the dot and the
  // stamp are the ones it could not draw at all before.
  await expect(row.locator('.kernelStatus')).toHaveClass(/ks-idle/);
  await expect(row.locator('.panel-row-time')).toHaveText(/^(now|[0-9]+m)$/);
  await expect(row.locator('.panel-row-name')).toHaveAttribute('title', /0 clients attached/);

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

/** A shell as `/api/terminals` reports it. */
interface TerminalModel {
  id: string;
  name: string;
  dir: string;
  started: string;
}

async function runningTerminals(request: APIRequestContext): Promise<TerminalModel[]> {
  return (await (await request.get('/api/terminals')).json()) as TerminalModel[];
}

/*
The terminals half of the same defect, and the same reason no mock can reach it.

The panel listed the terminal tabs this browser window had open, so it emptied on a reload while the
shells went on running and it went on naming a shell that had exited. Both halves are here, and both
are checked against `/api/terminals` as well as against the panel: a panel agreeing with itself is
what the bug looked like.

The shutdown is the other thing only a real server can answer. The shell is a process on this machine,
and a "Terminal shut down." that leaves it running is exactly the failure a mock cannot see.
*/
test('a running shell is listed after a reload, and shut down from the panel', async ({
  page,
  request,
}) => {
  await openApp(page);

  await page
    .locator('.launchSection')
    .filter({ hasText: 'Terminal' })
    .locator('.launcher-icon')
    .first()
    .click();
  await expect(page.locator('.tab-item').filter({ hasText: 'Terminal 1' })).toBeVisible();
  await expect.poll(async () => (await runningTerminals(request)).length).toBe(1);

  /*
   * Reloaded before the panel is read, which is the assertion the panel could not have passed before:
   * the tab it listed is gone with the page that held it.
   *
   * The shell goes too — a terminal's life is its websocket, and there is no reattaching to one — so
   * this opens a second terminal after the reload and checks the panel against the server rather than
   * against what this window remembers. What is being pinned down is where the list comes from.
   */
  await page.reload();
  await expect.poll(async () => (await runningTerminals(request)).length).toBe(0);

  await page
    .locator('.launchSection')
    .filter({ hasText: 'Terminal' })
    .locator('.launcher-icon')
    .first()
    .click();
  await expect.poll(async () => (await runningTerminals(request)).length).toBe(1);

  await page.getByLabel('Jupyter info').click();
  const open = panel(page);

  const row = open.locator('.panel-row').filter({ hasText: 'Terminal 1' });
  await expect(row.locator('.panel-row-label')).toHaveText('Terminal 1');
  await expect(row.locator('.panel-row-time')).toHaveText(/^(now|[0-9]+m)$/);
  await expect(open.getByRole('button', { name: /Terminals/ })).toContainText('1');

  // The id and not the name, because the name is not unique across windows. The tooltip is where the
  // panel puts it, so this is also the check that the row is bound to the shell the server reported.
  const listed = (await runningTerminals(request))[0];
  await expect(row.locator('.panel-row-name')).toHaveAttribute('title', new RegExp(listed.id));

  await row.getByTitle('Shut down Terminal 1').click();

  // The row going and the tab closing are the panel's claim. The empty list is the server's.
  await expect(row).toHaveCount(0);
  await expect(open.getByText('No terminals running.')).toBeVisible();
  await expect(page.locator('.tab-item').filter({ hasText: 'Terminal 1' })).toHaveCount(0);
  await expect.poll(async () => (await runningTerminals(request)).length).toBe(0);
});
