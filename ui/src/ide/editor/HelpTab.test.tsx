import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import { describe, expect, it, vi } from 'vitest';

import { FileTab } from '@/store/tabState';
import HelpTab from './HelpTab';

// The catalogue reaches helpCommands, and so useTabActions and the API client.
vi.mock('@/api', () => ({ deleteKernel: vi.fn(), logApiError: () => () => {} }));

const help: FileTab = {
  type: 'help',
  path: 'zasper:help',
  name: 'Help',
  active: true,
  extension: null,
  load_required: false,
  kernelspec: 'none',
};

function renderHelp() {
  return render(
    <Provider>
      <HelpTab data={help} />
    </Provider>
  );
}

function row(label: string): HTMLElement | null {
  return screen.queryByText(label)?.closest('.panel-row') ?? null;
}

describe('HelpTab', () => {
  // Nothing registers a command in these tests, which is the point: the list does not depend on
  // which tabs have been open.
  it("lists a notebook's shortcuts with no notebook open", () => {
    renderHelp();

    expect(row('Run Cell')).not.toBeNull();
    expect(row('Save Notebook')).not.toBeNull();
  });

  it('draws one cap per key, and a chord bound under two spellings once', () => {
    renderHelp();

    // Off mac, Mod- is Ctrl-, so both of Show All Commands' bindings render Ctrl Shift P.
    const chords = row('Show All Commands')!.querySelectorAll('.help-chord');
    expect(chords).toHaveLength(1);
    expect(chords[0].querySelectorAll('kbd')).toHaveLength(3);
  });

  it('lists only commands that have a key', () => {
    renderHelp();

    expect(row('Keyboard Shortcuts')).not.toBeNull();
    expect(row('About Zasper')).toBeNull();
  });

  it('filters on category as well as label, and says when nothing matches', () => {
    renderHelp();
    const filter = screen.getByPlaceholderText('Filter shortcuts');

    fireEvent.change(filter, { target: { value: 'notebook' } });
    expect(row('Run Cell')).not.toBeNull();
    expect(row('Zoom In')).toBeNull();

    fireEvent.change(filter, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No shortcut matches “nothing like it”.')).toBeTruthy();
  });
});
