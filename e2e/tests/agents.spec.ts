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
  // In the transcript, and said again in the live region beside it once the turn is over.
  await expect(page.locator('.agentChat').getByText('wrote notes.txt')).toBeVisible();
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

test('the agent’s own settings are chips under the field, as the agent answers them', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(`${fakeAgentBinary} --settings`);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  const model = page.getByRole('button', { name: 'Model: Large' });
  await expect(model).toBeVisible();
  await expect(page.getByRole('button', { name: 'Effort: High' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mode: Plan' })).toBeVisible();
  // The agent's mode replaces Zasper's.
  await expect(page.getByRole('button', { name: /^What the agent may do/ })).toHaveCount(0);

  await model.click();
  const menu = page.getByRole('menu', { name: 'Model' });
  await expect(menu).toBeInViewport();
  await menu.getByRole('menuitemradio', { name: /^Small/ }).click();

  // The small model has no effort: the agent's answer takes the chip away.
  await expect(page.getByRole('button', { name: 'Model: Small' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Effort/ })).toHaveCount(0);
});

test('past conversations drop over the conversation, and the one picked is replayed', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(fakeAgentBinary);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toBeEditable();

  await page.getByRole('button', { name: 'Past conversations' }).click();
  const menu = page.getByRole('menu', { name: 'Past conversations' });
  await expect(menu).toBeInViewport();
  await expect(menu.getByRole('menuitem', { name: /This chat/ })).toBeDisabled();
  // The conversation is still there, under the menu.
  await expect(field).toBeVisible();

  await menu.getByRole('menuitem', { name: 'Show more' }).click();
  await menu.getByRole('menuitem', { name: /An earlier chat/ }).click();

  await expect(menu).toHaveCount(0);
  await expect(page.locator('.agentChat').getByText('what is 2 + 2?')).toBeVisible();
  // The agent does not name it again as it replays it: the title the list gave heads the panel.
  await expect(page.locator('.agentPanel-title')).toContainText('An earlier chat');
});

test('the head takes the chat’s title, and shows how full its context is', async ({ page }) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(`${fakeAgentBinary} --settings`);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toBeEditable();

  await field.fill('name');
  await field.press('Enter');
  await expect(page.locator('.agentPanel-title').getByText('Sensor drift model')).toBeVisible();
  const meter = page.getByRole('button', { name: 'Context: 91% full' });
  await expect(meter).toBeVisible();

  await meter.click();
  const detail = page.getByRole('dialog', { name: 'Context and cost' });
  await expect(detail).toBeInViewport();
  await expect(detail).toContainText('182k of 200k tokens');
  await expect(detail).toContainText('$1.92');
  await expect(detail).toContainText('Large');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});

test('a / at the start of a message lists the agent’s commands, and one runs', async ({ page }) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(`${fakeAgentBinary} --commands`);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toHaveAttribute(
    'placeholder',
    'Ask the agent — @ for a file, / for a command'
  );

  await field.pressSequentially('/ec');
  const list = page.getByRole('listbox', { name: 'Commands' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('option')).toHaveCount(1);
  await field.press('Tab');
  await expect(field).toHaveValue('/echo ');
  await expect(list).toHaveCount(0);

  await field.pressSequentially('hello');
  await field.press('Enter');
  await expect(page.locator('.agentChat').getByText('echoed: hello')).toBeVisible();
  await expect(page.locator('.agentChat .agentCommand')).toHaveText('/echo');
});

test('a notice is one quiet line, and a compaction folds with its summary inside', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(`${fakeAgentBinary} --commands`);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toBeEditable();
  const chat = page.locator('.agentChat');

  await field.fill('notice');
  await field.press('Enter');
  await expect(chat.locator('.agentNotice')).toHaveText(
    'Auto mode is not available The chat is in Manual.'
  );
  // The turn is over before the next message: one sent during it is not taken.
  await expect(chat.getByText('noticed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

  await field.fill('/compact');
  await field.press('Escape');
  await field.press('Enter');
  await expect(chat.getByText(/The context is 91% full\./)).toBeVisible();
  const fold = chat.locator('details.agentFold');
  await expect(fold).toContainText('Conversation compacted · 182k → 18k tokens');
  await expect(fold.getByText('Fitted a drift per sensor.')).toBeHidden();
  await fold.locator('summary').click();
  await expect(fold.getByText('Fitted a drift per sensor.')).toBeVisible();
});
