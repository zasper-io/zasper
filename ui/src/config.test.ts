import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Where the app finds its server. The server writes its --base-url into the page's <base>, and every
 * address the app builds starts with it: a hub puts each person's server under a path of its own.
 */
describe('the base path', () => {
  async function configUnder(href: string) {
    const base = document.createElement('base');
    base.href = href;
    document.head.prepend(base);
    vi.resetModules();
    vi.stubEnv('DEV', false);
    return import('./config');
  }

  afterEach(() => {
    document.querySelectorAll('base').forEach((element) => element.remove());
    vi.unstubAllEnvs();
  });

  it('is empty at the root, so addresses are what they always were', async () => {
    const config = await configUnder('/');
    expect(config.BasePath).toBe('');
    expect(config.BaseApiUrl).toBe('');
    expect(config.BaseWebSocketUrl).toBe(`ws://${window.location.host}`);
  });

  it("is the server's path behind a hub, for the API and the websockets", async () => {
    const config = await configUnder('/user/prasun/');
    expect(config.BasePath).toBe('/user/prasun');
    expect(config.BaseApiUrl).toBe('/user/prasun');
    expect(config.BaseWebSocketUrl).toBe(`ws://${window.location.host}/user/prasun`);
  });
});
