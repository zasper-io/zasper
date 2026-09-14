import { describe, expect, it, vi } from 'vitest';

import { ALL_COMMANDS } from './catalog';
import { chordParts } from './keys';

// helpCommands, one of the tables, reaches useTabActions and so the API client.
vi.mock('@/api', () => ({ deleteKernel: vi.fn(), logApiError: () => () => {} }));

describe('ALL_COMMANDS', () => {
  it('declares each command once across every table', () => {
    const ids = ALL_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('draws every chord as caps with something on each', () => {
    for (const command of ALL_COMMANDS) {
      for (const binding of command.keys ?? []) {
        expect(
          chordParts(binding).every((part) => part !== ''),
          `${command.id}: ${binding}`
        ).toBe(true);
      }
    }
  });
});
