/*
What axe-core finds on each screen, held to a baseline so that the count can only go down.

axe is the automated half of an accessibility check: names, roles, contrast, landmarks, target sizes —
roughly a third of what a person with a screen reader would find, but the third that regresses
silently. Every violation on the screens below when this spec went in is in a11y-baseline.json, keyed by
screen, rule and element. One that is not in it fails the run. So does one that is in it and no longer
occurs, so that the change which fixes it also takes its line out.

    UPDATE_A11Y_BASELINE=1 npx playwright test a11y

rewrites the baseline from the current run. Look at the diff before committing it: a line added is a
regression being accepted.
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';

import { e2eRoot } from '../paths';
import { openApp, openTerminal, treeRow } from './helpers';

const BASELINE = join(e2eRoot, 'a11y-baseline.json');
const UPDATE = process.env.UPDATE_A11Y_BASELINE === '1';

/** WCAG 2.2 A and AA, and axe's best practices, which is where landmarks and headings live. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

type Baseline = Record<string, string[]>;

function readBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
  } catch {
    return {};
  }
}

/** One line per element per rule: `rule  target`. The help text goes in the failure, not the key. */
async function violations(page: Page): Promise<Map<string, string>> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const found = new Map<string, string>();
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      const key = `${violation.id}  ${node.target.join(' ')}`;
      found.set(key, `${key}  (${violation.impact}: ${violation.help})`);
    }
  }
  return found;
}

async function check(page: Page, screen: string): Promise<void> {
  const found = await violations(page);
  const baseline = readBaseline();

  if (UPDATE) {
    baseline[screen] = [...found.keys()].sort();
    const sorted = Object.fromEntries(
      Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b))
    );
    writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
    return;
  }

  const known = new Set(baseline[screen] ?? []);
  const added = [...found].filter(([key]) => !known.has(key)).map(([, line]) => line);
  const fixed = [...known].filter((key) => !found.has(key));
  expect.soft(added, `new accessibility violations on "${screen}"`).toEqual([]);
  expect.soft(fixed, `fixed on "${screen}": take these out of a11y-baseline.json`).toEqual([]);
}

async function openRail(page: Page, name: string): Promise<void> {
  await page.locator('.navigation-list').getByRole('button', { name, exact: true }).click();
}

async function chooseTheme(page: Page, id: string): Promise<void> {
  await openRail(page, 'Settings');
  await page.locator('#settings-theme').selectOption(id);
  await expect(page.locator('html')).toHaveAttribute('data-theme', id.split('-')[1]);
}

/** The fixture notebook, its kernel picker dismissed: a kernel would be a process to clean up. */
async function openNotebook(page: Page): Promise<void> {
  await treeRow(page, 'analysis.ipynb').click();
  const picker = page.locator('.modal').filter({ hasText: 'Select Kernel' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Close' }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator('.cellEditor .cm-content').first()).toBeVisible();
}

const SCREENS: { name: string; open: (page: Page) => Promise<void> }[] = [
  {
    name: 'launcher',
    open: async (page) => await expect(page.locator('.LauncherArea')).toBeVisible(),
  },
  {
    name: 'settings',
    open: async (page) => {
      await openRail(page, 'Settings');
      await expect(page.locator('#settings-theme')).toBeVisible();
    },
  },
  {
    name: 'help',
    open: async (page) => {
      await openRail(page, 'Help');
      await expect(page.locator('.tab-item').filter({ hasText: 'Help' })).toBeVisible();
    },
  },
  {
    name: 'kernel picker',
    open: async (page) => {
      await treeRow(page, 'analysis.ipynb').click();
      await expect(page.locator('.modal').filter({ hasText: 'Select Kernel' })).toBeVisible();
    },
  },
  { name: 'notebook', open: openNotebook },
  {
    name: 'file editor',
    open: async (page) => {
      await treeRow(page, 'notes.txt').click();
      await expect(page.locator('.cm-content').first()).toBeVisible();
    },
  },
  {
    name: 'palette',
    open: async (page) => {
      await page.keyboard.press('Control+Shift+P');
      await expect(page.locator('.palette-list .panel-row').first()).toBeVisible();
    },
  },
  {
    name: 'context menu',
    open: async (page) => {
      await treeRow(page, 'notes.txt').locator(':scope > a').click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();
    },
  },
  {
    name: 'search',
    open: async (page) => {
      await openRail(page, 'Search');
      await expect(page.getByRole('textbox', { name: 'Search', exact: true })).toBeVisible();
    },
  },
  {
    name: 'source control',
    open: async (page) => {
      await openRail(page, 'Source control');
      await expect(page.locator('.nav-content').filter({ visible: true }).first()).toBeVisible();
    },
  },
  {
    name: 'data',
    open: async (page) => {
      await openRail(page, 'Data');
      await expect(page.locator('.dataPanel')).toBeVisible();
    },
  },
  { name: 'terminal', open: openTerminal },
];

test('the sign-in page', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('#accessToken')).toBeVisible();
  await check(page, 'login');
});

for (const theme of ['teal-light', 'teal-dark']) {
  test.describe(theme, () => {
    // The theme is written to the throwaway config, so the dark run puts the default back after itself.
    test.afterEach(async ({ page }) => {
      if (theme !== 'teal-light') {
        const picker = page.locator('.modal').filter({ hasText: 'Select Kernel' });
        if (await picker.isVisible()) {
          await picker.getByRole('button', { name: 'Close' }).click();
        }
        await chooseTheme(page, 'teal-light');
      }
    });

    for (const screen of SCREENS) {
      test(screen.name, async ({ page }) => {
        await openApp(page);
        if (theme !== 'teal-light') {
          await chooseTheme(page, theme);
          await page
            .locator('.tab-item')
            .filter({ hasText: 'Settings' })
            .locator('.tab-close')
            .click();
        }
        await screen.open(page);
        await check(page, `${theme} ${screen.name}`);
      });
    }
  });
}
