import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { expect, Page } from '@playwright/test';

import { fakeAgentBinary, homeDir, projectDir } from '../paths';
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
  // Where the scripted agent keeps its sign-in, as a real one keeps its own.
  rmSync(join(homeDir, '.zasper-fake-agent-signed-in'), { force: true });
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

test('a subagent’s calls are under its row, and a command left running says so', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(fakeAgentBinary);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toBeEditable();

  await field.fill('explore');
  await field.press('Enter');
  const chat = page.locator('.agentChat');
  await expect(chat.getByText('explored')).toBeVisible();

  const task = chat.getByRole('button', { name: /Explore where readings are calibrated/ });
  const grep = chat.getByRole('button', { name: /grep calibrat/ });
  await expect(grep).toHaveClass(/is-nested/);
  await expect(task).not.toHaveClass(/is-nested/);
  const [above, below] = [await task.boundingBox(), await grep.boundingBox()];
  expect(below!.y).toBeGreaterThan(above!.y);
  expect(below!.x + 1).toBeGreaterThanOrEqual(above!.x);
  // The subagent's own words are not the reply.
  await expect(chat.getByText('the subagent thinking aloud')).toHaveCount(0);
  await expect(chat.getByRole('button', { name: /python load_raw\.py/ })).toContainText(
    'in the background'
  );
});

test('an agent not signed in is signed in from a terminal, says who it is, and signs out', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page
    .getByLabel('The command that starts the agent')
    .fill(`${fakeAgentBinary} --needs-sign-in`);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Sign in to fake-agent' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with Fake Account' }).click();
  await expect(
    page.getByRole('heading', { name: 'Finish signing in in the terminal' })
  ).toBeVisible();

  // The agent's own program, run in a Zasper terminal: its sign-in is what the next start finds.
  const terminal = page.locator('.xterm-rows');
  await expect(terminal).toContainText('Signed in to the fake agent.', { timeout: 15000 });

  await page.getByRole('button', { name: 'Try again' }).click();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toBeEditable();

  await page.getByRole('button', { name: /^More settings for / }).click();
  await expect(page.getByRole('menu', { name: /^More settings for / })).toContainText('Fake Pro');
  await page.getByRole('menuitem', { name: 'Sign out of fake-agent' }).click();
  await page
    .getByRole('dialog', { name: 'Sign out of fake-agent?' })
    .getByRole('button', { name: 'Sign out' })
    .click();

  await expect(page.getByText('Signed out of fake-agent.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Fake Account' })).toBeVisible();
});

test('an agent that opens a session signed out goes to signing in, not to a chat', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page
    .getByLabel('The command that starts the agent')
    .fill(`${fakeAgentBinary} --needs-sign-in --opens-signed-out`);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Sign in to fake-agent' })).toBeVisible();
  await expect(page.getByLabel('Message to the agent')).toHaveCount(0);
  await expect(page.locator('.agentStart .z-notice')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in with Fake Account' }).click();
  await expect(page.locator('.xterm-rows')).toContainText('Signed in to the fake agent.', {
    timeout: 15000,
  });

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Message to the agent')).toBeEditable();
  await page.getByRole('button', { name: /^More settings for / }).click();
  await page.getByRole('menuitem', { name: 'Sign out of fake-agent' }).click();
  await page
    .getByRole('dialog', { name: 'Sign out of fake-agent?' })
    .getByRole('button', { name: 'Sign out' })
    .click();
  await expect(page.getByText('Signed out of fake-agent.')).toBeVisible();
});

test('an agent signs itself in when asked, after one way it refuses, and names its plan', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page
    .getByLabel('The command that starts the agent')
    .fill(`${fakeAgentBinary} --needs-sign-in --tier`);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await page.getByRole('button', { name: 'Sign in with Fake Key' }).click();
  await expect(
    page.getByText('Fake Key did not sign fake-agent in: FAKE_KEY is not set.')
  ).toBeVisible();

  await page.getByRole('button', { name: 'Sign in with Fake Browser' }).click();
  await expect(page.getByRole('status', { name: 'Signing in to fake-agent' })).toBeVisible();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toBeEditable();

  await page.getByRole('button', { name: 'More settings for fake-agent' }).click();
  await expect(page.getByRole('menu', { name: 'More settings for fake-agent' })).toContainText(
    'Fake Tiersigned in'
  );
});

test('a plan the agent writes outside the project opens from the chat as a read-only tab', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(fakeAgentBinary);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toBeEditable();
  const chat = page.locator('.agentChat');

  await field.fill('plan');
  await field.press('Enter');
  await expect(chat.getByText('File plan.md')).toBeVisible();
  await page.getByRole('button', { name: 'Open plan.md' }).click();

  const tab = page.locator('.agentDocTab');
  await expect(tab.getByRole('note')).toContainText(
    'plan.md, read-only. To change it, reply in the chat'
  );
  await expect(tab.getByRole('heading', { name: 'The plan' })).toBeVisible();
  await expect(tab.locator('[contenteditable], textarea')).toHaveCount(0);

  // The agent's own link to it goes to the same tab, and the page stays where it is.
  const url = page.url();
  await chat.getByRole('link', { name: 'plan.md' }).click();
  await expect(page.locator('.tabName', { hasText: 'plan.md' })).toHaveCount(1);
  expect(page.url()).toBe(url);
});

test('the agent’s questions are a form the reader answers in the chat', async ({ page }) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(fakeAgentBinary);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toBeEditable();
  const chat = page.locator('.agentChat');

  await field.fill('question');
  await field.press('Enter');
  const form = chat.getByRole('form', { name: "The agent's question" });
  await expect(form.getByText('The agent has a question.')).toBeVisible();
  await expect(chat.getByText('Run ask_question')).toBeVisible();
  await form.getByRole('radio', { name: 'hi' }).check();
  await form.getByRole('checkbox', { name: 'type hints' }).check();
  await form.getByRole('textbox', { name: 'Other answer to Which extras?' }).fill('a test');
  await form.getByRole('button', { name: 'Answer' }).click();

  await expect(form).toHaveCount(0);
  await expect(chat.locator('.agentQuestion-answers')).toContainText('hi');
  await expect(chat.locator('.agentQuestion-answers')).toContainText('type hints, a test');
  await expect(chat).toContainText(
    'replied {"action":"accept","content":{"q1":"2","q2":["2"],"q2_other":"a test"}}'
  );
});

test('a message sent while an agent that steers works goes into the turn it is on', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(`${fakeAgentBinary} --steers`);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toBeEditable();
  const chat = page.locator('.agentChat');

  await field.fill('story');
  await field.press('Enter');
  await expect(chat).toContainText('Once upon a time');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await field.fill('make it shorter');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(chat).toContainText('steered: make it shorter');
  await expect(chat.locator('.agentMsg.is-user')).toHaveText(['story', 'make it shorter']);
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
});

test('an agent that needs no sign-in names its models by provider, and offers its sign-in under More', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(`${fakeAgentBinary} --opencode`);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByLabel('Message to the agent')).toBeEditable();

  await page.getByRole('button', { name: 'Model: Large' }).click();
  const models = page.getByRole('menu', { name: 'Model' });
  await expect(models.getByText('fake', { exact: true })).toBeVisible();
  await expect(models.getByText('other', { exact: true })).toBeVisible();
  await expect(models.getByRole('menuitemradio', { name: 'Huge' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^More settings for / }).click();
  await page.getByRole('menuitem', { name: 'Login with fake in a terminal' }).click();
  await expect(page.locator('.xterm-rows')).toContainText('Signed in to the fake agent.', {
    timeout: 15000,
  });
  // The marker its login leaves would sign in the agents the journeys after this one start signed out.
  rmSync(join(homeDir, '.zasper-fake-agent-signed-in'), { force: true });
});

test('a subagent works on in the background after its turn, under its row, and the agent takes up what it found', async ({
  page,
}) => {
  await openPanel(page);
  await page.getByText('Use another ACP agent').click();
  await page.getByLabel('The command that starts the agent').fill(`${fakeAgentBinary} --opencode`);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const field = page.getByLabel('Message to the agent');
  await expect(field).toBeEditable();

  await field.fill('subagent');
  await field.press('Enter');
  const row = page.locator('.agentTools .panel-row', { hasText: 'Explore · Find greet calls' });
  await expect(row).toContainText('in the background');
  // The turn is over while it works: the chat is free.
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await expect(page.locator('.agentTools .panel-row.is-nested')).toContainText('grep greet\\(');

  await expect(page.getByText('Explore reported back')).toBeVisible();
  await expect(row).toContainText('done');
  await expect(page.getByText('The subagent found one call to greet.')).toBeVisible();
  await row.click();
  await expect(page.locator('.agentTools-output')).toContainText('One call: main.py line 3.');
});
