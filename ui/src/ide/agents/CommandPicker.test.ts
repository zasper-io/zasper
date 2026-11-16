import { describe, expect, it } from 'vitest';

import { matchCommands } from './CommandPicker';

describe('matchCommands', () => {
  const commands = ['review', 'security-review', 'compact', 'context'].map((name) => ({
    name,
    description: '',
  }));

  it('puts the names that start with what was typed first, then those that hold it', () => {
    expect(matchCommands(commands, 'rev').map((command) => command.name)).toEqual([
      'review',
      'security-review',
    ]);
    expect(matchCommands(commands, 'CO').map((command) => command.name)).toEqual([
      'compact',
      'context',
    ]);
    expect(matchCommands(commands, '')).toHaveLength(4);
  });
});
