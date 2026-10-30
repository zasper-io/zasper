/*
A kernel's HTML output runs its scripts, in a sandboxed frame rather than in the page.

The script below says where it ran: its origin, and whether it could reach the page that holds it. In
the page it would be the server's origin with the IDE a property away, which is what lets an output act
as whoever is looking at the notebook, and behind a hub, in someone else's server. In the frame its
origin is no one's and the page is out of reach, while the output still draws what it was sent.
*/
import { expect } from '@playwright/test';

import { installedKernels, openApp, test, toolbarButton } from './helpers';

const NOTEBOOK = 'Untitled.ipynb';

const CELL = [
  'from IPython.display import HTML',
  'HTML("""<p id=where>not run</p><script>',
  'let page; try { page = parent.document.title ? "reached the page" : "no page" } catch (e) { page = "kept out of the page" }',
  'document.getElementById("where").textContent = "origin " + window.origin + ", " + page',
  '</script>""")',
].join('\n');

test.afterEach(async ({ request }) => {
  const sessions = (await (await request.get('/api/sessions')).json()) as Record<string, unknown>;
  for (const id of Object.keys(sessions)) {
    await request.delete(`/api/sessions/${id}`);
  }
  await request.delete('/api/contents', { data: { path: NOTEBOOK } });
});

test("an output's script runs in a sandboxed frame, out of the page's reach", async ({
  page,
  request,
}) => {
  const kernels = await installedKernels(request);
  test.skip(kernels.length === 0, 'no kernelspec is installed');

  await openApp(page);
  await page
    .locator('.launchSection')
    .filter({ hasText: 'Notebook' })
    .locator('.launcher-row')
    .first()
    .click();
  await expect(toolbarButton(page, 'Run Cell')).toBeVisible();

  const editor = page.locator('.cellEditor .cm-content').first();
  await editor.click();
  // Typed whole, not keystroke by keystroke: the editor would close the brackets and quotes itself.
  await page.keyboard.insertText(CELL);

  const frame = page.frameLocator('iframe.output-sandbox');
  await expect(async () => {
    await toolbarButton(page, 'Run Cell').click();
    await expect(frame.locator('#where')).toHaveText('origin null, kept out of the page', {
      timeout: 5_000,
    });
  }).toPass({ timeout: 60_000 });

  // Not in the page, and tall enough to be seen: the frame reports its own height.
  await expect(page.locator('#where')).toHaveCount(0);
  const box = await page.locator('iframe.output-sandbox').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(10);
});
