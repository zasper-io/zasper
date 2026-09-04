import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GitPanel from './GitPanel';

const getUncommittedFiles = vi.fn();
const getCommitGraph = vi.fn();

vi.mock('@/api', () => ({
  getUncommittedFiles: () => getUncommittedFiles(),
  getCommitGraph: () => getCommitGraph(),
  commitAndMaybePush: vi.fn(),
}));

const aCommit = {
  hash: 'abc123',
  message: 'the first one',
  author: 'Test',
  date: '2026-01-02',
  branch: 'main',
  parents: [] as string[],
};

beforeEach(() => {
  vi.clearAllMocks();
  getUncommittedFiles.mockResolvedValue({ files: [], isRepository: true });
  getCommitGraph.mockResolvedValue({ commits: [], isRepository: true });
});

describe('GitPanel', () => {
  it('asks the server for nothing while it is hidden', async () => {
    render(<GitPanel hidden />);

    // Every sidebar panel stays mounted, so an unguarded fetch here is three requests on every boot
    // for a panel nobody opened.
    await waitFor(() => expect(screen.getByText('Source control')).toBeInTheDocument());
    expect(getUncommittedFiles).not.toHaveBeenCalled();
    expect(getCommitGraph).not.toHaveBeenCalled();
  });

  it('fetches when it is opened', async () => {
    const { rerender } = render(<GitPanel hidden />);
    rerender(<GitPanel hidden={false} />);

    await waitFor(() => expect(getUncommittedFiles).toHaveBeenCalledTimes(1));
    expect(getCommitGraph).toHaveBeenCalledTimes(1);
  });

  it('says a project is not a repository rather than that it has nothing to commit', async () => {
    getUncommittedFiles.mockResolvedValue({ files: [], isRepository: false });
    getCommitGraph.mockResolvedValue({ commits: [], isRepository: false });
    render(<GitPanel hidden={false} />);

    expect(await screen.findByText('This project is not a git repository.')).toBeInTheDocument();
    // Nothing on it could work, so the commit form is not offered.
    expect(screen.queryByPlaceholderText('Enter commit message')).not.toBeInTheDocument();
    expect(screen.queryByText('No uncommitted files found.')).not.toBeInTheDocument();
    expect(await screen.findByText('No history.')).toBeInTheDocument();
  });

  it('offers the commit form for a repository with changes', async () => {
    getUncommittedFiles.mockResolvedValue({ files: ['notes.txt'], isRepository: true });
    getCommitGraph.mockResolvedValue({ commits: [aCommit], isRepository: true });
    render(<GitPanel hidden={false} />);

    expect(await screen.findByLabelText('notes.txt')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter commit message')).toBeInTheDocument();
    expect(screen.queryByText('This project is not a git repository.')).not.toBeInTheDocument();
    expect(await screen.findByText(/the first one -- Test/)).toBeInTheDocument();
  });

  it('shows an empty repository as a repository with no history', async () => {
    render(<GitPanel hidden={false} />);

    expect(await screen.findByText('No uncommitted files found.')).toBeInTheDocument();
    expect(await screen.findByText('No history.')).toBeInTheDocument();
  });
});
