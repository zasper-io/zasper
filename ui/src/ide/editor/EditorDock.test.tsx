import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { describe, expect, it, vi } from 'vitest';

import { dockOpenAtom, dockTabAtom, problemsAtom } from '@/store/languageServers';
import { referencesAtom } from '@/store/references';
import { Provider } from '@/testing/Provider';

import EditorDock from './EditorDock';

vi.mock('@/api', () => ({ deleteKernel: vi.fn(), logApiError: () => () => {} }));

let seen: { open: boolean; tab: string };

function Probe() {
  seen = { open: useAtomValue(dockOpenAtom), tab: useAtomValue(dockTabAtom) };
  return null;
}

function renderDock() {
  render(
    <Provider
      initialValues={[
        [dockOpenAtom, true],
        [
          problemsAtom,
          {
            'main.go': [{ severity: 'error', message: 'undefined: nme', line: 10, character: 22 }],
          },
        ],
        [
          referencesAtom,
          {
            symbol: 'greet',
            from: 'main.go',
            state: 'answered',
            total: 2,
            files: [
              {
                path: 'main.go',
                places: [
                  {
                    line: 4,
                    character: 5,
                    endCharacter: 10,
                    text: 'func greet() {}',
                    definition: true,
                  },
                  {
                    line: 10,
                    character: 4,
                    endCharacter: 9,
                    text: '    greet()',
                    definition: false,
                  },
                ],
              },
            ],
          },
        ],
      ]}
    >
      <EditorDock />
      <Probe />
    </Provider>
  );
}

describe('EditorDock', () => {
  it('opens on the problems, with a count on each tab', () => {
    renderDock();

    expect(screen.getByRole('tab', { name: /Problems/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Problems/ }).textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /References/ }).textContent).toContain('2');
    expect(screen.getByText('undefined: nme')).toBeInTheDocument();
  });

  it('brings the references forward without closing the panel', () => {
    renderDock();

    fireEvent.click(screen.getByRole('tab', { name: /References/ }));

    expect(seen).toEqual({ open: true, tab: 'references' });
    expect(screen.queryByText('undefined: nme')).not.toBeInTheDocument();
    // The name is marked in each line, and the definition's row says which one it is.
    // The list names the question, and marks the name in each line it found it on.
    expect(screen.getAllByText('greet').map((each) => each.tagName)).toEqual([
      'STRONG',
      'MARK',
      'MARK',
    ]);
    expect(screen.getByText('5:6 · definition')).toBeInTheDocument();
  });

  it('closes to nothing', () => {
    renderDock();

    fireEvent.click(screen.getByLabelText('Close panel'));

    expect(seen.open).toBe(false);
  });
});
