import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { expect, Page } from '@playwright/test';

import { fakeAgentBinary, projectDir } from '../paths';
import { openApp, test } from './helpers';

const notes = join(projectDir, 'notes.txt');

async function openPanel(page: Page) {
  await openApp(page);
  await page.getByRole('button', { name: 'Toggle the agent panel' }).click();
  await expect(page.getByRole('heading', { name: 'Work with an agent' })).toBeVisible();
}

// The fake agent: scripted answers, no agent installed. It writes the names of the tools it was given
// to the project as its session opens, which the specs after this one must not find there.
test.afterEach(async ({ request }) => {
  const chats = (await (await request.get('/api/agents/chats')).json()) as { id: string }[];
  for (const chat of chats) {
    await request.delete(`/api/agents/chats/${chat.id}`);
  }
  rmSync(join(projectDir, 'mcp-servers.txt'), { force: true });
});

test('an agent started from the panel changes a file, and the change is put back', async ({
  page,
}) => {
  const before = readFileSync(notes, 'utf8');
  await openPanel(page);

  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(fakeAgentBinary);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toBeEditable();
  await expect(page.getByText('fake-agent', { exact: true })).toBeVisible();

  await field.fill('write');
  await field.press('Enter');
  await expect(page.getByText('wrote notes.txt')).toBeVisible();
  await expect(page.getByText('1 file changed')).toBeVisible();
  expect(readFileSync(notes, 'utf8')).toBe('written by the agent\n');

  await page.getByRole('button', { name: 'Undo the turn’s change to notes.txt' }).click();
  await expect(page.getByText('undone', { exact: true })).toBeVisible();
  expect(readFileSync(notes, 'utf8')).toBe(before);
});

test('a slow start is shown, and Cancel goes back to the list', async ({ page }) => {
  await openPanel(page);
  // A command that never answers as an agent: the start waits on it until it is given up.
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill('sleep 60');
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.getByRole('status', { name: 'Starting sleep' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Work with an agent' })).toBeVisible();
});
