import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrustState } from '@/api/trust';
import { trustAskAtom, trustAtom } from '@/store/trust';
import TrustController from './TrustController';
import TrustDialog, { parentOf } from './TrustDialog';

const trustFolder = vi.fn();
const getTrust = vi.fn();
const loadKernelspecs = vi.fn();
const restartRestricted = vi.fn();

vi.mock('@/api', async () => ({
  trustFolder: (path: string) => trustFolder(path),
  getTrust: () => getTrust(),
  apiErrorMessage: (await import('@/api/client')).apiErrorMessage,
}));
vi.mock('@/store/kernelspecActions', () => ({
  useKernelspecActions: () => ({ loadKernelspecs }),
}));
vi.mock('@/lsp/servers', () => ({
  restartRestrictedLanguageServers: () => restartRestricted(),
}));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }));

const restricted: TrustState = {
  folder: '/home/me/work/analysis',
  trusted: false,
  by: '',
  trust_all: false,
  env: false,
  folders: [],
};
const trusted = (by: TrustState['by'] = 'folder'): TrustState => ({
  ...restricted,
  trusted: true,
  by,
});

function renderDialog() {
  const store = createStore();
  store.set(trustAtom, restricted);
  render(
    <Provider store={store}>
      <TrustDialog />
    </Provider>
  );
  return store;
}

describe('the trust question', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    trustFolder.mockImplementation(async (path: string) => ({ ...trusted(), through: path }));
  });

  it('names the folder, and staying restricted trusts nothing', () => {
    const store = renderDialog();
    act(() => store.set(trustAskAtom, { reason: 'open' }));

    expect(
      screen.getByText('Do you trust the authors of the files in this folder?')
    ).toBeInTheDocument();
    expect(screen.getByText('/home/me/work/analysis')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay restricted' }));

    expect(trustFolder).not.toHaveBeenCalled();
    expect(store.get(trustAskAtom)).toBeNull();
  });

  it('trusts the folder, or everything in the one it is in', async () => {
    const store = renderDialog();
    act(() => store.set(trustAskAtom, { reason: 'open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trust folder' }));
    await waitFor(() => expect(trustFolder).toHaveBeenCalledWith('/home/me/work/analysis'));
    await waitFor(() => expect(store.get(trustAtom)?.trusted).toBe(true));

    act(() => store.set(trustAskAtom, { reason: 'open' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Trust folder' }));
    await waitFor(() => expect(trustFolder).toHaveBeenLastCalledWith('/home/me/work'));
  });

  it('runs what was asked for once the folder is trusted', async () => {
    const onTrusted = vi.fn();
    const store = renderDialog();
    act(() =>
      store.set(trustAskAtom, {
        reason: 'run',
        notebook: 'analysis.ipynb',
        kernel: 'Python 3 (ipykernel)',
        onTrusted,
      })
    );

    expect(screen.getByText('Trust this folder to run its code?')).toBeInTheDocument();
    expect(screen.getByText('analysis.ipynb')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trust and run' }));

    await waitFor(() => expect(onTrusted).toHaveBeenCalled());
    expect(store.get(trustAskAtom)).toBeNull();
  });

  it('finds the folder a path is in', () => {
    expect(parentOf('/home/me/work/analysis')).toBe('/home/me/work');
    expect(parentOf('/home/me/work/analysis/')).toBe('/home/me/work');
    expect(parentOf('/analysis')).toBe('/');
    expect(parentOf('C:\\Users\\me\\analysis')).toBe('C:\\Users\\me');
  });
});

describe('TrustController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  function renderController() {
    const store = createStore();
    render(
      <Provider store={store}>
        <TrustController />
      </Provider>
    );
    return store;
  }

  it('asks about a folder that is not trusted, once a session', async () => {
    getTrust.mockResolvedValue(restricted);
    const store = renderController();
    await waitFor(() => expect(store.get(trustAskAtom)).toEqual({ reason: 'open' }));

    const again = renderController();
    await waitFor(() => expect(again.get(trustAtom)).not.toBeNull());
    expect(again.get(trustAskAtom)).toBeNull();
  });

  it('asks nothing in a trusted folder', async () => {
    getTrust.mockResolvedValue(trusted('all'));
    const store = renderController();
    await waitFor(() => expect(store.get(trustAtom)).not.toBeNull());
    expect(store.get(trustAskAtom)).toBeNull();
  });

  it('brings back the kernels and language servers restricted mode held back', async () => {
    getTrust.mockResolvedValue(restricted);
    const store = renderController();
    await waitFor(() => expect(store.get(trustAtom)).not.toBeNull());
    expect(loadKernelspecs).not.toHaveBeenCalled();

    act(() => store.set(trustAtom, trusted()));
    expect(loadKernelspecs).toHaveBeenCalled();
    expect(restartRestricted).toHaveBeenCalled();
  });
});
