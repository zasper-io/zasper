/*
What a screen reader is handed, on the journey todos/accessibility.md scripts for a pass by hand: names
said once, and announcements said once and in the right words. Chromium's accessibility tree is what
VoiceOver and NVDA read in Chrome, so this is the part of that pass a browser can answer; how each
reader voices it still needs a person.
*/
import { Page, expect } from '@playwright/test';

import { installedKernels, openApp, test, treeRow } from './helpers';

/** Every change to a live region since the page loaded, as the text it then held. */
async function recordAnnouncements(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const said: string[] = [];
    (window as unknown as { said: string[] }).said = said;
    const region = (node: Node | null) =>
      (node instanceof Element ? node : node?.parentElement)?.closest(
        '[aria-live], [role="status"], [role="alert"], [role="log"]'
      );
    new MutationObserver((records) => {
      const changed = new Set(records.map((record) => region(record.target)).filter(Boolean));
      for (const element of changed) {
        const text = element?.textContent?.trim() ?? '';
        if (text !== '') said.push(text);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

function announcements(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { said: string[] }).said.splice(0));
}

test('a control says its name once, and a row says what its name does not', async ({ page }) => {
  await openApp(page);

  // The tooltip is the button's name; as its description too, every icon button was said twice.
  await page.keyboard.press('Shift+F6');
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  await expect(refresh).toBeFocused();
  await expect(refresh).toHaveAccessibleDescription('');

  // A row's tooltip leads with the path, which the row's name and its place in the tree already say.
  const row = treeRow(page, 'notes.txt');
  await row.focus();
  await row.evaluate((element) =>
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  );
  await expect(row).toHaveAccessibleDescription(/^\d+ B · modified /);
});

test('the palette says its count once the typing stops', async ({ page }) => {
  await recordAnnouncements(page);
  await openApp(page);
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('combobox', { name: 'Search files and commands' })).toBeFocused();
  await expect
    .poll(() => page.locator('.palette [role="status"]').textContent())
    .toMatch(/results/);
  await announcements(page);

  // With nothing open the field searches files, and nothing is called this. Every count on the way
  // there would have been said before the last one.
  await page.keyboard.type('restart kernel', { delay: 30 });
  await expect(page.locator('.palette [role="status"]')).toHaveText('No results');
  expect(await announcements(page)).toEqual(['No results']);
});

test('a restart is said as a restart, not as the kernel going away', async ({ page, request }) => {
  test.skip((await installedKernels(request)).length === 0, 'no kernelspec is installed');
  await recordAnnouncements(page);
  await openApp(page);
  await treeRow(page, 'analysis.ipynb').click();
  const picker = page.getByRole('dialog').filter({ hasText: 'Select Kernel' });
  await picker.getByRole('button', { name: 'Select Kernel' }).click();
  await expect.poll(() => announcements(page), { timeout: 30_000 }).toContain('Kernel ready');

  await page.locator('.notebook-body').click();
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('Restart Kernel');
  await expect(
    page.getByRole('listbox', { name: 'Results' }).getByRole('option', { selected: true })
  ).toContainText('Restart Kernel');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByRole('button', { name: 'Restart' }).click();

  const said: string[] = [];
  await expect
    .poll(async () => said.push(...(await announcements(page))) && said, { timeout: 30_000 })
    .toContain('Kernel ready');
  const kernel = said.filter((text) => text.startsWith('Kernel'));
  expect(kernel).toEqual(['Kernel restarting', 'Kernel ready']);

  const sessions = (await (await request.get('/api/sessions')).json()) as Record<string, unknown>;
  for (const id of Object.keys(sessions)) {
    await request.delete(`/api/sessions/${id}`);
  }
});
