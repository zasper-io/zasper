import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from 'react-toastify';

import JupyterInfoPanel from './JupyterInfoPanel';
import { ApiError } from '@/api/client';
import {
  INotebookKernelMap,
  IKernelspecsState,
  kernelspecsAtom,
  kernelStatusAtom,
  notebookKernelMapAtom,
  terminalsAtom,
} from '@/store/AppState';
import { fileTabsAtom } from '@/store/TabState';

const listKernels = vi.fn();
const listSessions = vi.fn();
const interruptKernel = vi.fn();
const deleteKernel = vi.fn();

vi.mock('@/api', async () => ({
  listKernels: () => listKernels(),
  listSessions: () => listSessions(),
  interruptKernel: (id: string) => interruptKernel(id),
  deleteKernel: (id: string) => deleteKernel(id),
  logApiError: () => () => {},
  apiErrorMessage: (await import('@/api/client')).apiErrorMessage,
}));

// The panel raises toasts for what it did; whether they render is IDE.tsx's business, not this test's.
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

/**
 * A kernel as `/api/kernels` sends it. The three server-side fields are here because the panel renders
 * them: a kernel nothing in this window is attached to has nothing else to show a state from.
 */
const kernelModel = (name: string, id: string, state = '', connections = 0) => ({
  name,
  id,
  execution_state: state,
  last_activity: new Date(Date.now() - 3 * 60_000).toISOString(),
  connections,
});

const python = kernelModel('python3', 'kernel-1', 'idle', 1);
const r = kernelModel('ir', 'kernel-2');

/** A session as the server sends it, keyed by session id. */
const sessionFor = (kernel: typeof python, path: string) => ({
  id: `session-${kernel.id}`,
  path,
  name: path.split('/').pop() ?? path,
  type: 'notebook',
  kernel,
});

const theKernelspecs: IKernelspecsState = {
  python3: {
    name: 'python3',
    spec: { display_name: 'Python 3', language: 'python' },
    resources: {},
  },
  ir: { name: 'ir', spec: { display_name: 'R', language: 'R' }, resources: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
  listKernels.mockResolvedValue([python]);
  listSessions.mockResolvedValue({ 'session-kernel-1': sessionFor(python, 'src/demo.ipynb') });
  interruptKernel.mockResolvedValue(undefined);
  deleteKernel.mockResolvedValue(undefined);
});

// The poll is the only thing here that needs fake timers, and a test that left them on would hang the
// next one that waits for a promise.
afterEach(() => {
  vi.useRealTimers();
});

interface HarnessOptions {
  hidden?: boolean;
  kernelspecs?: IKernelspecsState;
  terminals?: Record<string, { id: string; name: string }>;
  statuses?: Record<string, string>;
  notebookKernelMap?: INotebookKernelMap;
}

/**
 * Renders the two things the panel changes outside itself: the tabs it opens, and the
 * notebook-to-kernel map it prunes on a shutdown. Neither is visible in the panel, so without this the
 * assertions about either would be about nothing.
 */
const Observer = () => {
  const tabs = useAtomValue(fileTabsAtom);
  const bound = useAtomValue(notebookKernelMapAtom);
  return (
    <>
      <span data-testid="tabs">{Object.keys(tabs).join(',')}</span>
      <span data-testid="bound">{Object.keys(bound).join(',')}</span>
    </>
  );
};

// An element rather than a render, so a test can hand the same tree back to `rerender` with `hidden`
// flipped. Rendering twice instead would remount, which is the one thing the visibility tests are not
// about.
function thePanel(options: HarnessOptions = {}) {
  return (
    <Provider
      initialValues={[
        [kernelspecsAtom, options.kernelspecs ?? theKernelspecs],
        [terminalsAtom, options.terminals ?? {}],
        [kernelStatusAtom, options.statuses ?? {}],
        [notebookKernelMapAtom, options.notebookKernelMap ?? {}],
      ]}
    >
      <JupyterInfoPanel hidden={options.hidden ?? false} />
      <Observer />
    </Provider>
  );
}

function renderPanel(options: HarnessOptions = {}) {
  return render(thePanel(options));
}

/** Waits for the first read to land, which is when there is a row to assert on. */
const theFirstRead = () => waitFor(() => expect(listKernels).toHaveBeenCalled());

describe('JupyterInfoPanel', () => {
  it('asks the server for nothing while it is hidden', async () => {
    renderPanel({ hidden: true });

    // Every sidebar panel stays mounted, and this one polls: unguarded, a panel nobody has opened
    // asks twice a second forever.
    await waitFor(() => expect(screen.getByText('Jupyter info')).toBeInTheDocument());
    expect(listKernels).not.toHaveBeenCalled();
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('reads the server when it is opened', async () => {
    const { rerender } = renderPanel({ hidden: true });
    rerender(thePanel({ hidden: false }));

    await waitFor(() => expect(listKernels).toHaveBeenCalledTimes(1));
    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it('keeps asking while it is open, since nothing reports a kernel that has died', async () => {
    vi.useFakeTimers();
    renderPanel();
    await vi.waitFor(() => expect(listKernels).toHaveBeenCalledTimes(1));

    // The notebook's socket closes when its kernel dies, but nothing tells this panel. There is no
    // watcher for kernels the way there is for files, so the panel asks again.
    listKernels.mockResolvedValue([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(listKernels).toHaveBeenCalledTimes(2);
    expect(screen.getByText('No kernels running.')).toBeInTheDocument();
  });

  it('stops asking once it is hidden again', async () => {
    vi.useFakeTimers();
    const { rerender } = renderPanel();
    await vi.waitFor(() => expect(listKernels).toHaveBeenCalledTimes(1));

    rerender(thePanel({ hidden: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });

    expect(listKernels).toHaveBeenCalledTimes(1);
  });

  it('has a section per kind of thing, each counting what is in it', async () => {
    listKernels.mockResolvedValue([python, r]);
    renderPanel({ terminals: { 'Terminal 1': { id: 'Terminal 1', name: 'Terminal 1' } } });
    await theFirstRead();

    // Running things first; what could be run is reference material and comes last.
    expect(await screen.findByText('Running kernels')).toBeInTheDocument();
    expect(screen.getByText('Terminals')).toBeInTheDocument();
    expect(screen.getByText('Available kernels')).toBeInTheDocument();

    const counts = screen.getAllByText(/^[0-9]+$/).map((node) => node.textContent);
    expect(counts).toEqual(['2', '1', '2']);
  });

  it('names the notebook a kernel is running, and what the kernel is called', async () => {
    renderPanel();

    // `Python 3` and not `python3`: the display name, as the launcher shows for the same kernel.
    expect(await screen.findByText('Python 3')).toBeInTheDocument();
    expect(screen.getByText('src/demo.ipynb')).toBeInTheDocument();
  });

  it('falls back to the kernelspec name when the specs have not arrived', async () => {
    renderPanel({ kernelspecs: {} });

    expect(await screen.findByText('python3')).toBeInTheDocument();
  });

  it('folds a section away and back', async () => {
    renderPanel();
    await screen.findByText('Python 3');

    const heading = screen.getByRole('button', { name: /Running kernels/ });
    expect(heading).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Python 3')).not.toBeInTheDocument();

    fireEvent.click(heading);
    expect(screen.getByText('Python 3')).toBeInTheDocument();
  });

  it('starts the available kernels folded, since nothing there is running', async () => {
    renderPanel();
    await theFirstRead();

    const heading = screen.getByRole('button', { name: /Available kernels/ });
    expect(heading).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(heading);
    // Both installed specs, where "Python 3" was already on screen as a running kernel.
    expect(screen.getAllByText('Python 3')).toHaveLength(2);
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('prefers this window\u2019s own reading of a kernel to the server\u2019s', async () => {
    // The same `status` messages, heard twice: this window hears them as they are published, the server
    // through a poll that is up to five seconds old. Where they disagree the local one is the newer.
    listKernels.mockResolvedValue([python]);
    const { container } = renderPanel({ statuses: { 'kernel-1': 'busy' } });
    await screen.findByText('Python 3');

    expect(container.querySelector('.kernelStatus')?.className).toContain('ks-busy');
  });

  it('shows the server\u2019s state for a kernel this window is not attached to', async () => {
    // The whole point of reading the server: this used to be the row with no dot, because the only
    // state the panel had came from the notebook this window had open.
    listKernels.mockResolvedValue([kernelModel('ir', 'kernel-2', 'busy')]);
    const { container } = renderPanel({ statuses: {} });
    await screen.findByText('R');

    expect(container.querySelector('.kernelStatus')?.className).toContain('ks-busy');
  });

  it('draws no dot when neither this window nor the server knows', async () => {
    listKernels.mockResolvedValue([python, r]);
    const { container } = renderPanel({ statuses: {} });
    await screen.findByText('Python 3');

    // `r` has no execution state, and inventing an idle dot for it would be the panel claiming
    // something about a kernel nothing has ever heard from.
    const dots = container.querySelectorAll('.kernelStatus');
    expect(dots).toHaveLength(1);
    expect(dots[0].className).toContain('ks-idle');
  });

  it('says how long since a kernel last said anything, and how much is on it', async () => {
    listKernels.mockResolvedValue([python]);
    renderPanel();

    // Short enough to sit beside two buttons in a 22px row; the row's tooltip says it in full, along
    // with the client count, which is how an abandoned kernel is told from one in use.
    expect(await screen.findByText('3m')).toBeInTheDocument();
    const row = screen.getByTitle(/^src\/demo\.ipynb/);
    expect(row.getAttribute('title')).toContain('Kernel is idle');
    expect(row.getAttribute('title')).toContain('1 client attached');
  });

  it('opens the notebook a kernel is running', async () => {
    renderPanel();
    fireEvent.click(await screen.findByText('Python 3'));

    // Keyed by path, so a notebook already open is brought forward rather than opened twice.
    expect(screen.getByTestId('tabs')).toHaveTextContent('src/demo.ipynb');
  });

  it('interrupts without asking, and reads the list again', async () => {
    renderPanel();
    fireEvent.click(await screen.findByLabelText('Interrupt Python 3'));

    await waitFor(() => expect(interruptKernel).toHaveBeenCalledWith('kernel-1'));
    expect(toast.success).toHaveBeenCalledWith('Interrupted.');
    // These endpoints answer with a message rather than the new state, so the panel has to ask.
    await waitFor(() => expect(listKernels).toHaveBeenCalledTimes(2));
  });

  it('asks before shutting a kernel down, and does nothing on cancel', async () => {
    renderPanel();
    fireEvent.click(await screen.findByLabelText('Shut down Python 3'));

    // The notebook's variables go with the kernel and there is no way back, so this is asked.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('src/demo.ipynb', { selector: 'strong' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteKernel).not.toHaveBeenCalled();
  });

  it('shuts a kernel down once confirmed, and unbinds the notebook from it', async () => {
    renderPanel({ notebookKernelMap: { 'src/demo.ipynb': python, 'other.ipynb': r } });
    fireEvent.click(await screen.findByLabelText('Shut down Python 3'));
    fireEvent.click(await screen.findByRole('button', { name: 'Shut down' }));

    await waitFor(() => expect(deleteKernel).toHaveBeenCalledWith('kernel-1'));
    // Left bound, the notebook would go on sending execute requests to a kernel that is gone.
    await waitFor(() => expect(screen.getByTestId('bound')).toHaveTextContent('other.ipynb'));
    expect(screen.getByTestId('bound')).not.toHaveTextContent('src/demo.ipynb');
  });

  it('leaves the notebook bound when the shutdown failed', async () => {
    deleteKernel.mockRejectedValue(new ApiError('DELETE', '/api/kernels/kernel-1', 404, ''));
    renderPanel({ notebookKernelMap: { 'src/demo.ipynb': python } });
    fireEvent.click(await screen.findByLabelText('Shut down Python 3'));
    fireEvent.click(await screen.findByRole('button', { name: 'Shut down' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByTestId('bound')).toHaveTextContent('src/demo.ipynb');
  });

  it('says a failed read in the panel rather than as a toast', async () => {
    // A read happens on a timer, so a server that has gone away would raise a toast every few seconds.
    listKernels.mockRejectedValue(
      new ApiError('GET', '/api/kernels', 500, 'kernels are unavailable')
    );
    renderPanel();

    expect(await screen.findByText('kernels are unavailable')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says what is empty, and says it of this window where that is all it knows', async () => {
    listKernels.mockResolvedValue([]);
    listSessions.mockResolvedValue({});
    renderPanel({ kernelspecs: {} });

    expect(await screen.findByText('No kernels running.')).toBeInTheDocument();
    // Terminals are tracked as tabs and the server has no endpoint that would report the rest.
    expect(screen.getByText('No terminals open in this window.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Available kernels/ }));
    expect(screen.getByText('No kernels are installed.')).toBeInTheDocument();
  });

  it('opens the tab a terminal row is for', async () => {
    renderPanel({ terminals: { 'Terminal 2': { id: 'Terminal 2', name: 'Terminal 2' } } });
    fireEvent.click(await screen.findByText('Terminal 2'));

    expect(screen.getByTestId('tabs')).toHaveTextContent('Terminal 2');
  });

  it('re-reads on demand, for a change made outside the panel', async () => {
    renderPanel();
    await theFirstRead();

    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(listKernels).toHaveBeenCalledTimes(2));
  });
});
