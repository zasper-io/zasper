/*
Every theme in the settings panel actually paints, and the one that was chosen is still there after a
reload.

A theme is stored as one name and applied as two attributes — `data-theme` for the polarity and
`data-accent` for the hue — and the failure mode of getting that wrong is not an exception. A name
that resolves to an accent with no ramp behind it, or a hue left behind on a theme that brings its own
palette, paints a window with some of its colours from one theme and the rest from another. So this
reads the computed values back off the page rather than asserting on the attributes alone: `--z-accent`
resolving to nothing is exactly what the registry's unit tests cannot see.
*/
import { Page, expect, test } from '@playwright/test';

import { openApp } from './helpers';

/** What the registry ships, and the order the panel lists them in (ui/src/themes/index.ts). */
const THEMES = [
  'teal-light',
  'teal-dark',
  'blue-light',
  'blue-dark',
  'slate-light',
  'slate-dark',
  'orange-light',
  'orange-dark',
  'jupyterlab',
];

/** The default, restored after each test: the theme is written to the throwaway config on selection. */
const DEFAULT = 'teal-light';

/** The tokens a theme has to answer for. Between them: the chrome, a fill, and the accent as ink. */
const TOKENS = ['--z-bg-topbar', '--z-bg-statusbar', '--z-accent', '--z-fg-accent'];

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#settings-theme')).toBeVisible();
}

async function chooseTheme(page: Page, id: string): Promise<void> {
  await page.locator('#settings-theme').selectOption(id);
}

/** What the browser resolves the given custom properties to on <html>, in order. */
function resolve(page: Page, names: string[]): Promise<string[]> {
  return page.evaluate((tokens) => {
    const style = getComputedStyle(document.documentElement);
    return tokens.map((token) => style.getPropertyValue(token).trim());
  }, names);
}

test.afterEach(async ({ page }) => {
  await openSettings(page);
  await chooseTheme(page, DEFAULT);
});

test('the panel lists every theme, and each one paints its own chrome', async ({ page }) => {
  await openApp(page);
  await openSettings(page);

  expect(
    await page
      .locator('#settings-theme option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
  ).toEqual(THEMES);

  /** Each theme's four resolved tokens, joined, so a theme that painted as another one shows up. */
  const seen = new Map<string, string>();

  for (const id of THEMES) {
    await chooseTheme(page, id);

    const [theme, accent] = id === 'jupyterlab' ? [id, null] : id.split('-').reverse();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    if (accent === null) {
      // Removed rather than emptied: `[data-accent]` in _accents.scss matches an empty value, which
      // would hand the hue mapping to the one theme that states all of those tokens itself.
      await expect(page.locator('html')).not.toHaveAttribute('data-accent');
    } else {
      await expect(page.locator('html')).toHaveAttribute('data-accent', accent);
    }

    const values = await resolve(page, TOKENS);
    // Every one of them resolves to a colour. An unset custom property resolves to '', and the
    // property it was used in falls back to the browser's default — a transparent status bar.
    for (const [index, value] of values.entries()) {
      expect(value, `${id} left ${TOKENS[index]} unset`).not.toBe('');
    }

    const signature = values.join(' ');
    expect(seen.get(signature), `${id} paints the same as ${seen.get(signature)}`).toBeUndefined();
    seen.set(signature, id);
  }
});

test('a chosen theme survives a reload', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await chooseTheme(page, 'orange-dark');

  // The colour before the reload, to compare against — the point is that the window comes back the
  // same, not that it comes back with the right attributes on it.
  const [topbar] = await resolve(page, ['--z-bg-topbar']);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'orange');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await resolve(page, ['--z-bg-topbar'])).toEqual([topbar]);
});
