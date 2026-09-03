/*
A notebook is created with a kernel, a cell is run, and the output survives a save and a reload.

The one journey where nothing is a stand-in: CodeMirror, the session, the kernel process, the execute
request over the websocket, the reply on iopub, and the save round-trip. Every one of those is mocked
in NotebookEditor.test.tsx, which is why a defect in how they fit together has only ever been found by
running the app by hand.
*/
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { fileTree, inProject, installedKernels, openApp, treeRow } from './helpers';

const NOTEBOOK = 'Untitled.ipynb';

/** What the save left on disk, or 0 when there is nothing readable there yet. */
function savedOutputCount(): number {
  try {
    const document = JSON.parse(readFileSync(inProject(NOTEBOOK), 'utf8'));
    return document.cells[0].outputs.length;
  } catch {
    return 0;
  }
}

test.afterEach(async ({ request }) => {
  // Put back the way the other specs expect to find it, so nothing depends on the order the files run
  // in. The sessions go first: each one owns a kernel process that outlives the page.
  const sessions = (await (await request.get('/api/sessions')).json()) as Record<string, unknown>;
  for (const id of Object.keys(sessions)) {
    await request.delete(`/api/sessions/${id}`);
  }
  await request.delete('/api/contents', { data: { path: NOTEBOOK } });
});

test('a cell is run, and its output survives a save and a reload', async ({ page, request }) => {
  const kernels = await installedKernels(request);
  test.skip(kernels.length === 0, 'no kernelspec is installed');

  await openApp(page);

  // The Launcher is the only way into a notebook that names a kernel up front; prepare.cjs seeds
  // exactly one, so which icon this is is not a matter of what the machine happens to have.
  await page
    .locator('.launchSection')
    .filter({ hasText: 'Notebook' })
    .locator('.launcher-icon')
    .first()
    .click();

  await expect(page.getByTitle('Run Cell')).toBeVisible();
  await expect(treeRow(page, NOTEBOOK)).toBeVisible();

  // A new notebook is written with no cells at all; the blank one here is the editor's, and only
  // reaches the file on the first save.
  const editor = page.locator('.cellEditor .cm-content').first();
  await editor.click();
  await page.keyboard.type('1 + 1');
  await expect(editor).toContainText('1 + 1');

  /*
   * Run until the answer comes back, rather than once and then a wait.
   *
   * Starting the kernel takes seconds, and a request sent before the socket is open goes nowhere at
   * all — there is no queue behind it. So the click is part of what is retried. This is not a sleep in
   * disguise: it stops the moment the output arrives, and `1 + 1` is the same question however many
   * times it is asked.
   */
  const output = page.locator('.inner-text');
  await expect(async () => {
    await page.getByTitle('Run Cell').click();
    await expect(output).toContainText('2', { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  await page.getByTitle('Save Notebook').click();
  await expect
    .poll(savedOutputCount, { message: 'the save did not reach the file' })
    .toBeGreaterThan(0);

  await page.reload();
  await expect(fileTree(page)).toBeVisible();
  await treeRow(page, NOTEBOOK).click();

  // Read back from the file: outputs are part of the document, not something the kernel is asked for
  // again.
  await expect(page.locator('.inner-text')).toContainText('2');

  // And the kernel it was created with was written into the file, so reopening it does not ask which
  // kernel to use.
  await expect(page.getByText('Select Kernel')).toHaveCount(0);
});
