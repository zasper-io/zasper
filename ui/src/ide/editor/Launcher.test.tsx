import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Launcher from './Launcher';
import {
  IKernelspecsState,
  KernelspecsStatus,
  kernelspecsAtom,
  kernelspecsStatusAtom,
} from '@/store/AppState';
import { fileTabsAtom } from '@/store/TabState';

const createContent = vi.fn();
const listKernelspecs = vi.fn();
const startEnvironmentSetup = vi.fn();
const getEnvironmentSetup = vi.fn();

vi.mock('@/api', async () => ({
  createContent: (parentDir: string, type: string) => createContent(parentDir, type),
  listKernelspecs: () => listKernelspecs(),
  startEnvironmentSetup: () => startEnvironmentSetup(),
  getEnvironmentSetup: () => getEnvironmentSetup(),
  logApiError: () => () => {},
  ApiError: (await import('@/api/client')).ApiError,
  PROJECT_KERNEL_NAME: 'project-venv',
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

function renderLauncher(
  specs: IKernelspecsState = kernelspecs,
  status: KernelspecsStatus = 'ready'
) {
  render(
    <Provider
      initialValues={[
        [kernelspecsAtom, specs],
        [kernelspecsStatusAtom, status],
      ]}
    >
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
  listKernelspecs.mockResolvedValue(kernelspecs);
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

  // Both routes to a tile with no picture, which drew src="undefined" and a broken image: a
  // kernelspec that names no logo, and one whose logo does not load.
  it('draws the kernel glyph for a kernelspec that ships no logo', () => {
    renderLauncher({ deno: { name: 'deno', spec: { display_name: 'Deno' }, resources: {} } });

    expect(tile('Deno')).toBeInTheDocument();
    expect(document.querySelector('.kernelSpecIconArea img')).not.toBeInTheDocument();
    expect(document.querySelector('.kernelSpecIconArea > .z-icon')).toBeInTheDocument();
  });

  it('falls back to the glyph when a logo the kernelspec names cannot be loaded', () => {
    renderLauncher();

    const logo = document.querySelector('.kernelSpecIconArea img') as HTMLImageElement;
    expect(logo).toBeInTheDocument();
    fireEvent.error(logo);

    expect(document.querySelector('.kernelSpecIconArea > .z-icon')).toBeInTheDocument();
  });

  // The tile grid's empty state, and the assertion the emoji does not come back: a notice says what
  // is wrong in words, and there is nothing here to click.
  it('says so when there is no kernel to run a notebook on', () => {
    renderLauncher({});

    expect(screen.getByRole('heading', { name: 'No kernels available' })).toBeInTheDocument();
    expect(screen.getByText('pip install ipykernel')).toBeInTheDocument();
    expect(document.querySelector('.noKernelsFound')?.textContent).not.toContain('❌');
    // No kernel tile: the only button naming Python is the offer to set one up.
    expect(document.querySelector('.kernelSpecIconArea')).not.toBeInTheDocument();
  });

  // The regression this state exists for: an empty list before the boot fetch has answered is not a
  // machine with no kernels on it, and the launcher is the tab that paints first.
  it('does not claim there are no kernels while the list is still being read', () => {
    renderLauncher({}, 'loading');

    expect(screen.getByText('Looking for installed kernels…')).toBeInTheDocument();
    expect(document.querySelector('.noKernelsFound')).not.toBeInTheDocument();
  });

  it('says nothing is known when the list could not be read', () => {
    renderLauncher({}, 'failed');

    expect(
      screen.getByRole('heading', { name: 'Could not read the installed kernels' })
    ).toBeInTheDocument();
    expect(screen.queryByText('pip install ipykernel')).not.toBeInTheDocument();
  });

  it('reads the list again from either notice, rather than naming an action it does not have', async () => {
    renderLauncher({}, 'failed');

    fireEvent.click(tile('Check again'));

    await waitFor(() => expect(listKernelspecs).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Python 3 (ipykernel)' })).toBeInTheDocument();
  });

  it("offers the project's own environment first", () => {
    renderLauncher({
      ...kernelspecs,
      'project-venv': {
        name: 'project-venv',
        spec: { display_name: 'Python 3.12 (.venv)' },
        resources: {},
      },
    });

    const labels = [...document.querySelectorAll('.launcher-icon-label')].map((l) => l.textContent);
    expect(labels[0]).toBe('Python 3.12 (.venv)');
  });

  it('sets up a kernel for the project from the empty notice, shows its log, and lists it', async () => {
    startEnvironmentSetup.mockResolvedValue({ state: 'running', log: '$ uv venv .venv\n' });
    getEnvironmentSetup.mockResolvedValue({
      state: 'succeeded',
      log: '$ uv venv .venv\nInstalled 1 package\n',
      kernel: 'project-venv',
    });
    listKernelspecs.mockResolvedValue({
      'project-venv': {
        name: 'project-venv',
        spec: { display_name: 'Python 3.12 (.venv)' },
        resources: {},
      },
    });
    renderLauncher({});

    fireEvent.click(tile('Set up a Python kernel'));

    expect(await screen.findByText('Setting up a Python kernel…')).toBeInTheDocument();
    expect(screen.getByLabelText('Setup log')).toHaveTextContent('$ uv venv .venv');
    expect(tile('Check again')).toBeDisabled();
    expect(
      await screen.findByRole('button', { name: 'Python 3.12 (.venv)' }, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(getEnvironmentSetup).toHaveBeenCalled();
  });

  it('says what went wrong when the setup fails, and offers to try again', async () => {
    startEnvironmentSetup.mockResolvedValue({
      state: 'failed',
      log: '$ uv venv .venv\n',
      error: 'no Python was found to create the environment with',
    });
    renderLauncher({});

    fireEvent.click(tile('Set up a Python kernel'));

    expect(await screen.findByRole('alert')).toHaveTextContent('no Python was found');
    expect(tile('Try again')).toBeInTheDocument();
    expect(screen.getByLabelText('Setup log')).toHaveTextContent('$ uv venv .venv');
  });

  it('follows a setup already running elsewhere rather than starting a second', async () => {
    const { ApiError } = await import('@/api/client');
    startEnvironmentSetup.mockRejectedValue(
      new ApiError('POST', '/api/environment/setup', 409, '{"state":"running"}')
    );
    getEnvironmentSetup.mockReturnValue(new Promise(() => {}));
    renderLauncher({});

    fireEvent.click(tile('Set up a Python kernel'));

    expect(await screen.findByText('Setting up a Python kernel…')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
