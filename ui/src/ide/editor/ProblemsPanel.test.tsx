import { fireEvent, render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { describe, expect, it, vi } from 'vitest';

import { problemsAtom, revealPositionAtom } from '@/store/languageServers';
import { fileTabsAtom } from '@/store/tabState';
import { Provider } from '@/testing/Provider';

import ProblemsPanel from './ProblemsPanel';

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

function renderPanel() {
  return render(
    <Provider
      initialValues={[
        [
          problemsAtom,
          {
            'main.go': [
              {
                severity: 'warning',
                message: 'unnecessary use of fmt.Sprintf',
                source: 'simplifyrange',
                line: 9,
                character: 12,
              },
              {
                severity: 'error',
                message: 'undefined: nme',
                source: 'compiler',
                code: 'UndeclaredName',
                line: 10,
                character: 22,
              },
            ],
            'cmd/helper.go': [
              { severity: 'info', message: 'could be simpler', line: 0, character: 0 },
            ],
          },
        ],
      ]}
    >
      <ProblemsPanel />
      <Probe />
    </Provider>
  );
}

describe('ProblemsPanel', () => {
  it('lists every file’s problems, by file and then by severity, with where each is', () => {
    renderPanel();

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.classList.contains('panel-row-name'));
    expect(rows.map((row) => row.textContent)).toEqual([
      'could be simplercmd/helper.go 1:1',
      'undefined: nmecompiler UndeclaredName · main.go 11:23',
      'unnecessary use of fmt.Sprintfsimplifyrange · main.go 10:13',
    ]);
  });

  it('opens a problem’s file at the problem', () => {
    renderPanel();

    fireEvent.click(screen.getByText('undefined: nme'));

    expect(seen.active).toBe('main.go');
    expect(seen.reveal).toEqual({ path: 'main.go', line: 10, character: 22 });
  });
});
