import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { describe, expect, it, vi } from 'vitest';

import { revealPositionAtom } from '@/store/languageServers';
import { ReferenceSearch, referencesAtom } from '@/store/references';
import { fileTabsAtom } from '@/store/tabState';
import { Provider } from '@/testing/Provider';

import ReferencesList from './ReferencesList';

vi.mock('@/api', () => ({ deleteKernel: vi.fn(), logApiError: () => () => {} }));

let seen: { active?: string; reveal: unknown };

function Probe() {
  const tabs = useAtomValue(fileTabsAtom);
  seen = {
    active: Object.values(tabs).find((tab) => tab.active)?.path,
    reveal: useAtomValue(revealPositionAtom),
  };
  return null;
}

const answered: ReferenceSearch = {
  symbol: 'greet',
  from: 'main.go',
  state: 'answered',
  total: 3,
  files: [
    {
      path: 'main.go',
      places: [
        { line: 4, character: 5, endCharacter: 10, text: 'func greet() {}', definition: true },
        { line: 10, character: 4, endCharacter: 9, text: '    greet(name)', definition: false },
      ],
    },
    {
      path: 'lib/greet_test.go',
      places: [
        {
          line: 8,
          character: 11,
          endCharacter: 16,
          text: '    got := greet("x")',
          definition: false,
        },
      ],
    },
  ],
};

function renderList(references: ReferenceSearch | null) {
  render(
    <Provider initialValues={[[referencesAtom, references]]}>
      <ReferencesList />
      <Probe />
    </Provider>
  );
}

describe('ReferencesList', () => {
  it('says what was asked, and groups the places by file', () => {
    renderList(answered);

    expect(screen.getByText(/3 uses in 2 files/)).toBeInTheDocument();
    expect(screen.getByText('main.go')).toBeInTheDocument();
    expect(screen.getByText('greet_test.go')).toBeInTheDocument();
    // Where it is as well as the line, which is the width the panel under the editor has.
    expect(screen.getByText('5:6 · definition')).toBeInTheDocument();
    expect(screen.getByText('11:5')).toBeInTheDocument();
    // The indentation is dropped, so short rows read together.
    expect(screen.getByText('(name)')).toBeInTheDocument();
  });

  it('opens a place’s file at the place', () => {
    renderList(answered);

    fireEvent.click(screen.getByText('9:12'));

    expect(seen.active).toBe('lib/greet_test.go');
    expect(seen.reveal).toEqual({ path: 'lib/greet_test.go', line: 8, character: 11 });
  });

  it('folds a file away', () => {
    renderList(answered);

    fireEvent.click(screen.getByTitle('main.go'));

    expect(screen.queryByText('5:6 · definition')).not.toBeInTheDocument();
    expect(screen.getByText('9:12')).toBeInTheDocument();
  });

  it('says what to press when nothing has been asked', () => {
    renderList(null);

    expect(screen.getByText(/lists every place it is used/)).toBeInTheDocument();
  });

  it('says why there is no answer', () => {
    renderList({
      symbol: 'greet',
      from: 'main.go',
      state: 'unanswered',
      total: 0,
      files: [],
      message: 'No language server is running for this file.',
    });

    expect(screen.getByText('No language server is running for this file.')).toBeInTheDocument();
  });

  it('says a name that is used nowhere is used nowhere', () => {
    renderList({ symbol: 'unused', from: 'main.go', state: 'answered', total: 0, files: [] });

    expect(screen.getByText(/is not used anywhere/)).toBeInTheDocument();
  });
});
