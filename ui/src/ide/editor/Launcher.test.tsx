import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Launcher from './Launcher';
import { IKernelspecsState, kernelspecsAtom } from '@/store/AppState';
import { fileTabsAtom } from '@/store/TabState';

const createContent = vi.fn();

vi.mock('@/api', () => ({
  createContent: (parentDir: string, type: string) => createContent(parentDir, type),
  logApiError: () => () => {},
}));

const kernelspecs: IKernelspecsState = {
  python3: {
    name: 'python3',
    spec: { display_name: 'Python 3 (ipykernel)' },
    resources: { 'logo-svg': '/kernelspecs/python3/logo-svg.svg' },
  },
  ir: {
    name: 'ir',
    spec: { display_name: 'R' },
    resources: { 'logo-64x64': '/kernelspecs/ir/logo-64x64.png' },
  },
};

/** The tabs the launcher has opened, itself aside. */
function OpenTabs() {
  const tabs = useAtomValue(fileTabsAtom);
  return (
    <span data-testid="tabs">
      {Object.keys(tabs)
        .filter((key) => key !== 'Launcher')
        .join(',')}
    </span>
  );
}

function renderLauncher(specs: IKernelspecsState = kernelspecs) {
  render(
    <Provider initialValues={[[kernelspecsAtom, specs]]}>
      <Launcher data={{ active: true }} />
      <OpenTabs />
    </Provider>
  );
}

/** A tile, found the way a keyboard finds it — which it could not do at all before. */
function tile(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

beforeEach(() => {
  vi.clearAllMocks();
  createContent.mockResolvedValue({ name: 'Untitled.ipynb', path: 'Untitled.ipynb' });
});

describe('Launcher', () => {
  it('offers one tile per kernelspec, named by its display name', () => {
    renderLauncher();

    expect(tile('Python 3 (ipykernel)')).toBeInTheDocument();
    expect(tile('R')).toBeInTheDocument();
  });

  it('opens a notebook on the kernel whose tile was clicked', async () => {
    renderLauncher();

    fireEvent.click(tile('R'));

    await waitFor(() => expect(createContent).toHaveBeenCalledWith('', 'notebook'));
    await waitFor(() => expect(screen.getByTestId('tabs')).toHaveTextContent('Untitled.ipynb'));
  });

  it('opens a terminal from its own tile', () => {
    renderLauncher();

    fireEvent.click(tile('Terminal'));

    expect(screen.getByTestId('tabs')).toHaveTextContent('Terminal 1');
  });

  // The tile grid's empty state, and the assertion the emoji does not come back: a notice says what
  // is wrong in words, and there is nothing here to click.
  it('says so when there is no kernel to run a notebook on', () => {
    renderLauncher({});

    expect(screen.getByRole('heading', { name: 'No kernels available' })).toBeInTheDocument();
    expect(screen.getByText('pip install ipykernel')).toBeInTheDocument();
    expect(document.querySelector('.noKernelsFound')?.textContent).not.toContain('❌');
    expect(screen.queryByRole('button', { name: /Python/ })).not.toBeInTheDocument();
  });
});
