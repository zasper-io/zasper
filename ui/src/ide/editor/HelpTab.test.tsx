import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import { describe, expect, it, vi } from 'vitest';

import { useRegisterCommands } from '@/commands/registry';
import { ICommand } from '@/commands/types';
import { IfileTab } from '@/store/TabState';
import HelpTab from './HelpTab';

// helpCommands, for its two URLs, reaches useTabActions and so the API client.
vi.mock('@/api', () => ({ deleteKernel: vi.fn(), logApiError: () => () => {} }));

const help: IfileTab = {
  type: 'help',
  path: 'zasper:help',
  name: 'Help',
  active: true,
  extension: null,
  load_required: false,
  kernelspec: 'none',
};

function command(overrides: Partial<ICommand>): ICommand {
  return {
    id: 'test:x',
    label: 'X',
    category: 'View',
    scope: 'app',
    execute: vi.fn(),
    ...overrides,
  };
}

function Registered({ commands, active = true }: { commands: ICommand[]; active?: boolean }) {
  useRegisterCommands(commands, active);
  return null;
}

const showAll = command({
  id: 'palette:open-commands',
  label: 'Show All Commands',
  keys: ['Mod-Shift-p', 'Ctrl-Shift-p'],
});
const zoomIn = command({ id: 'view:zoom-in', label: 'Zoom In', keys: ['Mod-='] });
const runCell = command({
  id: 'notebook:run-cell',
  label: 'Run Cell',
  category: 'Notebook',
  keys: ['Ctrl-Enter'],
});

function row(label: string): HTMLElement | null {
  return screen.queryByText(label)?.closest('.panel-row') ?? null;
}

describe('HelpTab', () => {
  it('draws one cap per key, and a chord bound under two spellings once', () => {
    render(
      <Provider>
        <Registered commands={[showAll]} />
        <HelpTab data={help} />
      </Provider>
    );

    // Off mac, Mod- is Ctrl-, so both bindings render Ctrl Shift P.
    const chords = row('Show All Commands')!.querySelectorAll('.help-chord');
    expect(chords).toHaveLength(1);
    expect(chords[0].querySelectorAll('kbd')).toHaveLength(3);
  });

  it('lists only commands that have a key', () => {
    render(
      <Provider>
        <Registered commands={[zoomIn, command({ id: 'help:about', label: 'About Zasper' })]} />
        <HelpTab data={help} />
      </Provider>
    );

    expect(row('Zoom In')).not.toBeNull();
    expect(row('About Zasper')).toBeNull();
  });

  it('filters on category as well as label, and says when nothing matches', () => {
    render(
      <Provider>
        <Registered commands={[zoomIn, runCell]} />
        <HelpTab data={help} />
      </Provider>
    );
    const filter = screen.getByPlaceholderText('Filter shortcuts');

    fireEvent.change(filter, { target: { value: 'notebook' } });
    expect(row('Run Cell')).not.toBeNull();
    expect(row('Zoom In')).toBeNull();

    fireEvent.change(filter, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No shortcut matches “nothing like it”.')).toBeTruthy();
  });

  it("still lists a tab's shortcuts once that tab has stopped registering them", () => {
    const tree = (notebookActive: boolean) => (
      <Provider>
        <Registered commands={[runCell]} active={notebookActive} />
        <HelpTab data={help} />
      </Provider>
    );
    const { rerender } = render(tree(true));

    // Help coming to the front is what takes the notebook's commands out of the registry.
    rerender(tree(false));
    expect(row('Run Cell')).not.toBeNull();
  });
});
