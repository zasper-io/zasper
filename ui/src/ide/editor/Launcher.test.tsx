import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { Provider } from '@/testing/Provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Launcher from './Launcher';
import {
  KernelspecsState,
  KernelspecsStatus,
  kernelspecsAtom,
  kernelspecsStatusAtom,
} from '@/store/kernels';
import { RecentFile, recentFilesAtom } from '@/store/recentFiles';
import { serverOsAtom } from '@/store/serverInfo';
import { fileTabsAtom } from '@/store/tabState';

const createContent = vi.fn();
const listKernelspecs = vi.fn();
const startEnvironmentSetup = vi.fn();
const getEnvironmentSetup = vi.fn();
const getKernelspecResource = vi.fn();

vi.mock('@/api', async () => ({
  createContent: (parentDir: string, type: string) => createContent(parentDir, type),
  // The Running list reads the server rather than this window's atoms; an empty answer draws no list.
  listKernels: () => Promise.resolve([]),
  listSessions: () => Promise.resolve({}),
  listTerminals: () => Promise.resolve([]),
  deleteKernel: () => Promise.resolve(),
  deleteTerminal: () => Promise.resolve(),
  apiErrorMessage: (failure: unknown) => String(failure),
  getKernelspecResource: (path: string) => getKernelspecResource(path),
  listKernelspecs: () => listKernelspecs(),
  startEnvironmentSetup: () => startEnvironmentSetup(),
  getEnvironmentSetup: () => getEnvironmentSetup(),
  logApiError: () => () => {},
  ApiError: (await import('@/api/client')).ApiError,
  PROJECT_KERNEL_NAME: 'project-venv',
}));

const kernelspecs: KernelspecsState = {
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
  specs: KernelspecsState = kernelspecs,
  status: KernelspecsStatus = 'ready',
  os = 'darwin',
  recent: RecentFile[] = []
) {
  render(
    <Provider
      initialValues={[
        [kernelspecsAtom, specs],
        [kernelspecsStatusAtom, status],
        [serverOsAtom, os],
        [recentFilesAtom, recent],
      ]}
    >
      <Launcher data={{ active: true }} />
      <OpenTabs />
    </Provider>
  );
}

/** A kernel's row, found the way a keyboard finds it — which it could not do at all before. */
function row(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

/** The letters a kernelspec with no logo is drawn with, which used to be the kernel glyph. */
function mark(): string | undefined {
  return document.querySelector('.launcher-mark')?.textContent ?? undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  createContent.mockResolvedValue({ name: 'Untitled.ipynb', path: 'Untitled.ipynb' });
  listKernelspecs.mockResolvedValue(kernelspecs);
  getKernelspecResource.mockResolvedValue(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
  // jsdom has neither.
  URL.createObjectURL = vi.fn(() => 'blob:logo');
  URL.revokeObjectURL = vi.fn();
});

function logo(): HTMLImageElement | null {
  return document.querySelector('.kernelSpecIconArea img');
}

describe('Launcher', () => {
  it('offers one row per kernelspec, named by its display name', () => {
    renderLauncher();

    expect(row('Python 3 (ipykernel)')).toBeInTheDocument();
    expect(row('R')).toBeInTheDocument();
  });

  // Ten kernelspecs is an ordinary laptop, and a flat list of them says nothing about which is which.
  it("groups the kernels: the project's own, then Python, then everything else", () => {
    renderLauncher({
      'project-venv': {
        name: 'project-venv',
        spec: { display_name: 'Python 3.12 (.venv)', language: 'python' },
        resources: {},
      },
      python3: {
        name: 'python3',
        spec: { display_name: 'Python 3 (ipykernel)', language: 'python' },
        resources: {},
      },
      ir: { name: 'ir', spec: { display_name: 'R', language: 'r' }, resources: {} },
    });

    const labels = [...document.querySelectorAll('.launcher-group')].map((el) => el.textContent);
    expect(labels).toEqual(['This project', 'Python', 'Other languages']);
    // The project's environment is the only row on its line, because it is the usual answer.
    expect(row('Python 3.12 (.venv)').className).toContain('is-project');
  });

  it('opens a notebook on the kernel whose row was clicked', async () => {
    renderLauncher();

    fireEvent.click(row('R'));

    await waitFor(() => expect(createContent).toHaveBeenCalledWith('', 'notebook'));
    await waitFor(() => expect(screen.getByTestId('tabs')).toHaveTextContent('Untitled.ipynb'));
  });

  // Both routes to a row with no picture, which drew src="undefined" and a broken image: a
  // kernelspec that names no logo, and one whose logo does not load. The fallback is the language's
  // letters, because the kernel glyph drew the same picture for every one of them.
  it("draws the language's letters for a kernelspec that ships no logo", () => {
    renderLauncher({
      deno: { name: 'deno', spec: { display_name: 'Deno', language: 'typescript' }, resources: {} },
    });

    expect(row('Deno')).toBeInTheDocument();
    expect(logo()).not.toBeInTheDocument();
    expect(mark()).toBe('ts');
    expect(getKernelspecResource).not.toHaveBeenCalled();
  });

  // Through the api, which is what carries the session; a linked <img> was a 401 on every load.
  it('draws the logo the kernelspec names, fetched with the session', async () => {
    renderLauncher({ python3: kernelspecs.python3 });

    await waitFor(() => expect(logo()).toHaveAttribute('src', 'blob:logo'));
    expect(getKernelspecResource).toHaveBeenCalledWith('/kernelspecs/python3/logo-svg.svg');
  });

  it('falls back to the glyph when a logo the kernelspec names cannot be fetched', async () => {
    getKernelspecResource.mockRejectedValue(new Error('401'));
    renderLauncher({ python3: kernelspecs.python3 });

    await waitFor(() => expect(getKernelspecResource).toHaveBeenCalled());
    await act(async () => {});

    expect(logo()).not.toBeInTheDocument();
    expect(mark()).toBe('py');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('falls back to the glyph when a fetched logo will not draw', async () => {
    renderLauncher({ python3: kernelspecs.python3 });
    await waitFor(() => expect(logo()).toBeInTheDocument());

    fireEvent.error(logo()!);

    expect(logo()).not.toBeInTheDocument();
    expect(mark()).toBe('py');
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

    fireEvent.click(row('Check again'));

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

    const labels = [...document.querySelectorAll('.launcher-row-label')].map((l) => l.textContent);
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

    fireEvent.click(row('Set up a Python kernel'));

    expect(await screen.findByText('Setting up a Python kernel…')).toBeInTheDocument();
    expect(screen.getByLabelText('Setup log')).toHaveTextContent('$ uv venv .venv');
    expect(row('Check again')).toBeDisabled();
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

    fireEvent.click(row('Set up a Python kernel'));

    expect(await screen.findByRole('alert')).toHaveTextContent('no Python was found');
    expect(row('Try again')).toBeInTheDocument();
    expect(screen.getByLabelText('Setup log')).toHaveTextContent('$ uv venv .venv');
  });

  it('follows a setup already running elsewhere rather than starting a second', async () => {
    const { ApiError } = await import('@/api/client');
    startEnvironmentSetup.mockRejectedValue(
      new ApiError('POST', '/api/environment/setup', 409, '{"state":"running"}')
    );
    getEnvironmentSetup.mockReturnValue(new Promise(() => {}));
    renderLauncher({});

    fireEvent.click(row('Set up a Python kernel'));

    expect(await screen.findByText('Setting up a Python kernel…')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('the Recent section', () => {
  const recent: RecentFile[] = [
    { path: 'lib/clean.py', name: 'clean.py', type: 'file' },
    { path: 'analysis.ipynb', name: 'analysis.ipynb', type: 'notebook' },
  ];

  it('is not there for a project nothing has been opened in', () => {
    renderLauncher();

    expect(screen.queryByRole('heading', { name: 'Recent' })).not.toBeInTheDocument();
  });

  it('lists what was open, with the folder each one is in', () => {
    renderLauncher(kernelspecs, 'ready', 'darwin', recent);

    expect(screen.getByRole('heading', { name: 'Recent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'clean.py' })).toBeInTheDocument();
    expect(screen.getByText('lib')).toBeInTheDocument();
  });

  it('opens one, as the file browser would', () => {
    renderLauncher(kernelspecs, 'ready', 'darwin', recent);

    fireEvent.click(screen.getByRole('button', { name: 'analysis.ipynb' }));

    expect(screen.getByTestId('tabs')).toHaveTextContent('analysis.ipynb');
  });
});
