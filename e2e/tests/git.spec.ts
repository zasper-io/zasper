/*
A change's whole life in the source control panel: edited in the editor, staged, committed, and then in
the history under the box that committed it.

Worth running for real rather than only against mocks. Every frontend test of this panel answers its own
api calls, so none of them can catch the two bugs this journey is here to keep fixed: a commit that takes
more than what was staged, and a staged file the panel does not show at all. What git itself thinks is
read back with `git` at the end, because a panel saying the right thing over a repository that was never
touched is exactly the failure a mock cannot see.
*/
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { Locator, Page, expect, test } from '@playwright/test';

import { homeDir, projectDir } from '../paths';
import { inProject, openApp, treeRow } from './helpers';

const FILE = 'notes.txt';

/** A file the fixture does not have, for the tests that need one git has never seen. */
const UNTRACKED = 'from-the-palette.txt';

/**
 * git in the throwaway project, for reading back what the panel claims to have done.
 *
 * The same environment prepare.cjs seeded the repository with, so this reads the identity and settings
 * the server's own git calls see rather than the developer's.
 */
function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: projectDir,
    env: { ...process.env, HOME: homeDir, GIT_CONFIG_NOSYSTEM: '1' },
    encoding: 'utf8',
  }).trim();
}

/** The open panel, so a locator cannot match the file browser that is still mounted beside it. */
function panel(page: Page): Locator {
  return page.locator('.nav-content:not(.is-hidden)');
}

/**
 * A row of the history, by its subject.
 *
 * The row and not the panel's text: a message typed into the commit box is the text content of the
 * textarea holding it, so a plain text match for one finds it before the commit is even sent — and every
 * assertion after that then reads a repository nothing has happened to yet.
 */
function historyRow(page: Page, subject: string): Locator {
  return panel(page).locator('.commit-summary').filter({ hasText: subject });
}

async function openPanel(page: Page): Promise<Locator> {
  await openApp(page);
  await page.getByLabel('Source control').click();

  const open = panel(page);
  await expect(open.getByText('Source control')).toBeVisible();
  return open;
}

/**
 * Opens the file, replaces everything in it, and saves, leaving source control open again.
 *
 * The sidebar shows one panel at a time, so the tree cannot be reached while source control is: the
 * journey a user makes is over to the explorer and back. Select-all then type, so what the repository
 * differs by afterwards is known exactly rather than being the fixture with something appended wherever
 * the click happened to land the cursor. The wait is on disk, because the panel reads its status from
 * the server and asserting on it before the write has landed is a race.
 */
async function editAndSave(page: Page, text: string): Promise<void> {
  await page.getByLabel('File explorer').click();
  await treeRow(page, FILE).click();

  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('A plain file');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
  await page.keyboard.press('ControlOrMeta+s');

  await expect.poll(() => readFileSync(inProject(FILE), 'utf8')).toBe(text);

  await page.getByLabel('Source control').click();
}

/**
 * An editor tab, by the whole of the name on it.
 *
 * Exact, because the tabs this is asked about are `notes.txt` and `notes.txt (diff)`: a substring match
 * for the first of those is both of them.
 */
function tab(page: Page, name: string): Locator {
  return page.locator('.tab-item').filter({ has: page.getByText(name, { exact: true }) });
}

/**
 * Runs a git command through the command palette, which is the only way to reach one.
 *
 * Control rather than Meta for the chord, as palette.spec.ts explains: it is registered both ways, and
 * Control is the spelling that works on a mac and on CI alike. The `>` the chord fills in is kept: the
 * palette searches the project's files as well, and a query left to match those too would depend on
 * what the files here are called.
 */
async function runFromPalette(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  const input = page.locator('.palette-input');
  await expect(input).toBeFocused();

  await input.fill(`>${query}`);
  // One match, so what Enter runs is not a matter of ordering.
  await expect(page.locator('.palette-item')).toHaveCount(1);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

/** The commit prepare.cjs seeded, which every test here is reset back to. */
let seedCommit = '';

test.beforeAll(() => {
  /*
   * The repository has to be the project's own. The server finds the one a project is inside by walking
   * up from it, and e2e/.tmp is inside this checkout — so if prepare.cjs had not run, everything below
   * would be staging and committing into the repository being worked on.
   */
  expect(
    existsSync(inProject('.git')),
    'the throwaway project is not a repository of its own; prepare.cjs did not run'
  ).toBe(true);

  seedCommit = git('rev-parse', 'HEAD');
});

/*
Back to the seeded commit, not just the file's old contents: these tests commit, so putting the text
back would leave the repository a commit ahead and the file changed against it. A reset restores every
tracked file as the fixture had it, which is also what the specs after this one expect to find.
*/
test.afterEach(() => {
  // Back onto main first: these tests switch branch, and a reset would otherwise leave the next spec
  // wherever this one ended. Forced because the reset that cleans the worktree has not happened yet.
  git('checkout', '-f', '-q', 'main');
  git('reset', '--hard', '-q', seedCommit);

  // A reset restores tracked files; a file git never got to hear about is left where it is, and the
  // specs after this one would find it in the tree.
  rmSync(inProject(UNTRACKED), { force: true });

  // And the branches the panel made, which nothing else here removes.
  for (const name of git('for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n')) {
    if (name !== '' && name !== 'main') {
      git('branch', '-D', name);
    }
  }
});

test('a file is staged, committed, and then in the history', async ({ page }) => {
  const open = await openPanel(page);

  // Which branch, above the sections rather than in them: prepare.cjs asked for main by name so this
  // does not depend on the developer's init.defaultBranch.
  await expect(open.locator('.git-branch')).toHaveText('main');
  await expect(open.getByText('No changes.')).toBeVisible();
  await expect(historyRow(page, 'the fixture project')).toBeVisible();

  await editAndSave(page, 'edited by the git spec');

  // There with nothing pressed to make it appear: the panel reads the status itself, where the old one
  // showed whatever it had been told once.
  await expect(open.getByText('Changes')).toBeVisible();

  await open.getByLabel(`Stage ${FILE}`).click();

  // The section that used to be empty whatever was in it, because the panel filtered on the worktree
  // side of the index and a staged file is unmodified there.
  await expect(open.getByText('Staged')).toBeVisible();
  await expect(open.getByLabel(`Unstage ${FILE}`)).toBeVisible();
  expect(git('diff', '--cached', '--name-only')).toBe(FILE);

  await open.getByPlaceholder('Commit message').fill('staged from the panel');
  await open.getByRole('button', { name: 'Commit', exact: true }).click();

  // In the list directly below the box that made it, which needs a read of its own: without one the
  // history stayed as it was when the panel was opened.
  await expect(historyRow(page, 'staged from the panel')).toBeVisible();
  await expect(open.getByText('No changes.')).toBeVisible();
  // Emptied only on success, so a commit git refused keeps the message that was written for it.
  await expect(open.getByPlaceholder('Commit message')).toHaveValue('');

  // And git agrees, which is the assertion no mocked test can make.
  expect(git('log', '-1', '--pretty=%s')).toBe('staged from the panel');
  expect(git('status', '--porcelain')).toBe('');

  // The row names the commit the way anything outside this panel does, which the old history — a flat
  // `message -- author`, with no hash and no date — gave no way to do.
  const row = historyRow(page, 'staged from the panel');
  await expect(row).toContainText(git('rev-parse', '--short', 'HEAD'));
  await expect(row).toContainText('just now');

  // And opens onto what it changed, which is a read of its own against the commit's parent.
  await row.click();
  const detail = panel(page).locator('.commit-detail');
  await expect(detail.locator('.commit-file')).toHaveCount(1);
  await expect(detail).toContainText(FILE);
});

test('a commit takes what is staged and leaves the rest alone', async ({ page }) => {
  const open = await openPanel(page);

  // Two changed files, one staged. The panel used to send a list of files and then commit with go-git's
  // All, so ticking one of these committed both; what is committed is now what is staged, and there is
  // nothing in the UI that can say otherwise.
  await editAndSave(page, 'edited by the git spec');
  writeFileSync(inProject('data', 'table.csv'), 'left,behind\n1,2\n');

  await open.getByLabel(`Stage ${FILE}`).click();
  await expect(open.getByLabel(`Unstage ${FILE}`)).toBeVisible();

  await open.getByPlaceholder('Commit message').fill('one file only');
  await open.getByRole('button', { name: 'Commit', exact: true }).click();

  await expect(historyRow(page, 'one file only')).toBeVisible();

  expect(git('show', '--pretty=', '--name-only', 'HEAD')).toBe(FILE);
  // Still changed and still unstaged: the commit went past it.
  expect(git('diff', '--name-only')).toBe('data/table.csv');
  expect(git('diff', '--cached', '--name-only')).toBe('');
});

test('a branch is created from the menu, switched away from, and deleted', async ({ page }) => {
  const open = await openPanel(page);

  // The fixture has no remote, so there is nowhere to fetch from and none of it is offered.
  await expect(open.getByLabel('Fetch')).toHaveCount(0);

  await open.getByLabel('Branch: main').click();
  await open.getByPlaceholder('Find or create a branch').fill('spec/topic');
  await open.getByRole('menuitem', { name: 'Create branch spec/topic' }).click();

  // Both places that name a branch. The status bar reads it once on boot and hears about a checkout no
  // other way, so before phase 2 it went on saying main for the rest of the session.
  await expect(open.locator('.git-branch')).toHaveText('spec/topic');
  await expect(page.locator('.statusBar')).toContainText('spec/topic');
  expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('spec/topic');

  // Made from where HEAD was, so nothing is a change against it.
  await expect(open.getByText('No changes.')).toBeVisible();
  expect(git('rev-parse', 'spec/topic')).toBe(seedCommit);

  await open.getByLabel('Branch: spec/topic').click();
  // Not an exact name: every row carries a Font Awesome glyph, which is a character of the button's
  // text as far as the accessibility tree is concerned.
  await open.getByRole('menuitem', { name: 'main' }).click();

  await expect(open.locator('.git-branch')).toHaveText('main');
  expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');

  // And now that it is not checked out, it can go. The menu stays open over the shortened list.
  await open.getByLabel('Branch: main').click();
  await open.getByLabel('Delete spec/topic').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Delete branch');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(open.getByRole('menuitem', { name: 'spec/topic' })).toHaveCount(0);
  expect(git('for-each-ref', '--format=%(refname:short)', 'refs/heads')).toBe('main');
});

/*
A change opens as the two versions of it, side by side.

For real rather than against mocks because a MergeView is two CodeMirror editors that cannot mount under
jsdom at all: the frontend test of the diff tab asserts on what the view was handed and stops there. This
is the only place that says the diff is on screen.
*/
test('a change opens as a diff of what the file was against what it is', async ({ page }) => {
  const open = await openPanel(page);
  await editAndSave(page, 'edited by the git spec');

  await open.locator('.panel-row-name').filter({ hasText: FILE }).click();

  // A tab of its own, beside the editor for the same file rather than instead of it: tabs are keyed by
  // path, so a diff keyed by the file's own path would have been that editor.
  await expect(tab(page, `${FILE} (diff)`)).toBeVisible();
  await expect(tab(page, FILE)).toBeVisible();

  const body = page.locator('.diff-body');
  // Two editors, which is what a side-by-side diff is.
  await expect(body.locator('.cm-editor')).toHaveCount(2);
  // The index on the left and the file on disk on the right, which is what an unstaged change is.
  await expect(body).toContainText('A plain file');
  await expect(body).toContainText('edited by the git spec');
  await expect(page.locator('.diff-head')).toContainText('Working tree');

  // And the staged comparison of the same file is a second diff: HEAD against the index is a different
  // pair of documents, so it cannot be the same tab.
  await open.getByLabel(`Stage ${FILE}`).click();
  await expect(open.getByText('Staged')).toBeVisible();
  await open.locator('.panel-row-name').filter({ hasText: FILE }).click();

  await expect(tab(page, `${FILE} (staged)`)).toBeVisible();
  await expect(tab(page, `${FILE} (diff)`)).toBeVisible();
});

/*
A diff of more than fits on screen can be scrolled through.

A MergeView keeps its two editors at their natural height so the sides cannot drift apart, and scrolls
the pair as one element. Anything with a height of its own between the pane and them is therefore a lid:
the editors grow past it, the pane clips what sticks out, and the rest of the file cannot be reached.
Nothing but a browser can see that, since it is entirely a question of resolved heights.
*/
test('a diff taller than the pane scrolls', async ({ page }) => {
  const open = await openPanel(page);

  // Straight to disk and then a refresh, rather than through the editor: what this needs is a few
  // hundred lines, which is a long time to spend typing.
  const lines = Array.from({ length: 400 }, (_, index) => `line ${index + 1}`);
  writeFileSync(inProject(FILE), `${lines.join('\n')}\n`);
  await open.getByTitle('Refresh').click();

  await open.locator('.panel-row-name').filter({ hasText: FILE }).click();

  const merge = page.locator('.cm-mergeView');
  await expect(merge).toBeVisible();

  const room = await merge.evaluate((el) => ({
    content: el.scrollHeight,
    visible: el.clientHeight,
    pane: el.parentElement?.clientHeight ?? 0,
  }));
  // Bounded by the pane, and holding more than that: the two halves of being scrollable at all.
  expect(room.visible).toBe(room.pane);
  expect(room.content).toBeGreaterThan(room.visible);

  await merge.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await merge.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  // The far end of the file, which is the part that could not be reached. Asserted after the scroll
  // rather than before it because an editor only renders the lines it is showing.
  await expect(merge).toContainText('line 400');
});

/*
The same work from the command palette, with source control never opened.

The panel registers these commands while it is mounted and hidden, and while it is hidden it reads
nothing — so this is the case that says a palette command does not need the panel to have been looked at
first: it reads for itself, and shows the panel when the answer is on it.
*/
test('git is worked from the palette without the panel being opened', async ({ page }) => {
  await openApp(page);

  // Straight to disk, since the point here is that nothing in the sidebar has been touched.
  writeFileSync(inProject(FILE), 'edited for the palette\n');
  writeFileSync(inProject(UNTRACKED), 'and one file git has never seen\n');

  await runFromPalette(page, 'Stage All');

  // Both of them, the untracked one included: `git add` is how a new file is first told to git, and a
  // "stage all" that skipped it would leave the commit incomplete.
  await expect
    .poll(() => git('diff', '--cached', '--name-only').split('\n'))
    .toEqual([UNTRACKED, FILE].sort());
  // The file browser is still the panel on screen: staging needed no part of source control.
  await expect(page.locator('.nav-content:not(.is-hidden)')).toContainText('File explorer');

  await runFromPalette(page, 'Commit');

  // Nothing is written yet, so rather than commit an empty message it shows the box that is empty.
  const open = panel(page);
  await expect(open.getByText('Source control')).toBeVisible();
  await expect(open.getByPlaceholder('Commit message')).toBeFocused();
  expect(git('log', '-1', '--pretty=%s')).toBe('the fixture project');

  await page.keyboard.type('committed from the palette');
  await runFromPalette(page, 'Commit');

  await expect(historyRow(page, 'committed from the palette')).toBeVisible();
  expect(git('log', '-1', '--pretty=%s')).toBe('committed from the palette');
  expect(git('status', '--porcelain')).toBe('');
});

test('discarding a change asks first, and then puts the file back', async ({ page }) => {
  const open = await openPanel(page);

  await editAndSave(page, 'thrown away by the git spec');
  await expect(open.getByLabel(`Discard ${FILE}`)).toBeVisible();

  await open.getByLabel(`Discard ${FILE}`).click();

  // There is no undo and git keeps no copy of an uncommitted change, so the dialog is the only thing
  // between a click and lost work.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Discard changes');
  await expect(dialog).toContainText(FILE);
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click();

  await expect(open.getByText('No changes.')).toBeVisible();
  expect(git('status', '--porcelain')).toBe('');
});
