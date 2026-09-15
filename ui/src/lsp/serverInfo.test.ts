import { describe, expect, it } from 'vitest';

import { versionOf } from './serverInfo';

describe('versionOf', () => {
  it('takes a plain version as it is', () => {
    expect(versionOf('1.1.389')).toBe('1.1.389');
    expect(versionOf('clangd version 17.0.0')).toBe('clangd');
  });

  // What gopls v0.18.1 actually sends in serverInfo.version.
  it('finds the version inside a build record', () => {
    expect(
      versionOf(
        '{"GoVersion":"go1.23.7","Path":"golang.org/x/tools/gopls","Main":{"Version":"v0.18.1"}}'
      )
    ).toBe('v0.18.1');
  });

  it('says nothing rather than something unreadable', () => {
    expect(versionOf(undefined)).toBeUndefined();
    expect(versionOf('{not json')).toBeUndefined();
  });
});
