import { afterEach, describe, expect, it } from 'vitest';

import { allowWidgetCdn, createCdnLoader } from './cdnLoader';

describe('createCdnLoader', () => {
  afterEach(() => {
    allowWidgetCdn(true);
  });

  it('answers a bundled module itself', async () => {
    const controls = { name: 'controls' };
    const load = createCdnLoader({ '@jupyter-widgets/controls': controls });

    await expect(load('@jupyter-widgets/controls', '2.0.0')).resolves.toBe(controls);
  });

  // Turned off in Settings, nothing is fetched: the widget says why instead.
  it('refuses a module from the CDN when that is turned off', async () => {
    allowWidgetCdn(false);
    const load = createCdnLoader({});

    await expect(load('bqplot', '0.12.43')).rejects.toThrow(
      /bqplot@0\.12\.43 .*turned off in Settings/
    );
    expect(document.querySelector('script[src*="require"]')).toBeNull();
  });

  it('still answers bundled modules when the CDN is turned off', async () => {
    allowWidgetCdn(false);
    const base = { name: 'base' };
    const load = createCdnLoader({ '@jupyter-widgets/base': base });

    await expect(load('@jupyter-widgets/base', '6.0.0')).resolves.toBe(base);
  });
});
