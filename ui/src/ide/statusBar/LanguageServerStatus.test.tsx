import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LanguageServerList } from '@/api';
import { languageServerListAtom, ServerStatus, serverStatusAtom } from '@/store/languageServers';
import { Provider } from '@/testing/Provider';

import LanguageServerStatus from './LanguageServerStatus';

const restart = vi.fn();
const stop = vi.fn();

vi.mock('@/api', () => ({ deleteKernel: vi.fn(), logApiError: () => () => {} }));
vi.mock('@/lsp/servers', () => ({
  restartLanguageServer: (server: string) => restart(server),
  stopLanguageServer: (server: string) => stop(server),
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const list: LanguageServerList = {
  enabled: true,
  typeChecking: '',
  servers: [
    {
      language: 'go',
      name: 'Go',
      server: 'gopls',
      command: 'gopls',
      found: true,
      path: '/home/me/go/bin/gopls',
      install: 'go install golang.org/x/tools/gopls@latest',
      configured: false,
    },
    {
      language: 'python',
      name: 'Python',
      server: 'basedpyright',
      command: 'basedpyright-langserver --stdio',
      found: false,
      path: '',
      install: 'pip install basedpyright',
      configured: false,
    },
  ],
};

function renderItem(fileName: string, statuses: Record<string, ServerStatus> = {}, servers = list) {
  return render(
    <Provider
      initialValues={[
        [languageServerListAtom, servers],
        [serverStatusAtom, statuses],
      ]}
    >
      <LanguageServerStatus fileName={fileName} />
    </Provider>
  );
}

describe('LanguageServerStatus', () => {
  it('names a ready server and its version, and restarts or stops it from its menu', () => {
    renderItem('main.go', { go: { state: 'ready', name: 'gopls', version: 'v0.18.1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Language server gopls, ready' }));
    expect(screen.getByText('gopls v0.18.1 · ready')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Restart' }));
    expect(restart).toHaveBeenCalledWith('go');
  });

  it('says a server failed, and why, in words', () => {
    renderItem('main.go', {
      go: { state: 'failed', name: 'gopls', message: 'gopls exited: exit status 2' },
    });

    expect(screen.getByText(/gopls failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Language server gopls, failed' }));
    expect(screen.getByText('gopls exited: exit status 2')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Stop' })).toBeDisabled();
  });

  // A missing server is said here and nowhere else, and the menu says what to install.
  it('says there is no server, and what to install', () => {
    renderItem('prepare.py');

    fireEvent.click(screen.getByRole('button', { name: 'No Python language server' }));

    expect(screen.getByText('pip install basedpyright')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy the command' })).toBeInTheDocument();
  });

  it('says nothing for a file no server serves, or when servers are turned off', () => {
    const { container } = renderItem('notes.txt');
    expect(container).toBeEmptyDOMElement();

    const off = renderItem('main.go', {}, { ...list, enabled: false });
    expect(off.container).toBeEmptyDOMElement();
  });
});
