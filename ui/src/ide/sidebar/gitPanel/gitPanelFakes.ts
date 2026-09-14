/**
 * What GitPanel's tests put behind '@/api' and react-toastify. Nothing here imports the app: a mock
 * factory that imported a module importing what it mocks would wait on itself.
 */
import { vi } from 'vitest';

export const getGitStatus = vi.fn();
export const getLog = vi.fn();
export const getCommitDetail = vi.fn();
export const initRepository = vi.fn();
export const stageFiles = vi.fn();
export const unstageFiles = vi.fn();
export const discardFiles = vi.fn();
export const commitStaged = vi.fn();
export const getBranches = vi.fn();
export const checkoutBranch = vi.fn();
export const deleteBranch = vi.fn();
export const fetchRemote = vi.fn();
export const pullRemote = vi.fn();
export const pushRemote = vi.fn();

export async function apiModule() {
  const client = await import('@/api/client');
  return {
    // Not stubbed: the real one only builds a URL, and the socket it is handed to is mocked anyway.
    websocketUrl: client.websocketUrl,
    getGitStatus: () => getGitStatus(),
    getLog: (options: unknown) => getLog(options),
    getCommitDetail: (hash: string) => getCommitDetail(hash),
    initRepository: () => initRepository(),
    stageFiles: (paths: string[]) => stageFiles(paths),
    unstageFiles: (paths: string[]) => unstageFiles(paths),
    discardFiles: (paths: string[], deleteUntracked: boolean) =>
      discardFiles(paths, deleteUntracked),
    commitStaged: (message: string, options: unknown) => commitStaged(message, options),
    getBranches: () => getBranches(),
    checkoutBranch: (...args: unknown[]) => checkoutBranch(...args),
    deleteBranch: (...args: unknown[]) => deleteBranch(...args),
    fetchRemote: () => fetchRemote(),
    pullRemote: () => pullRemote(),
    pushRemote: () => pushRemote(),
    // Not the panel's own, but the tab actions it opens diffs through are in its tree.
    deleteKernel: vi.fn(),
    logApiError: () => () => {},
    emptyGitStatus: (await import('@/api/git')).emptyGitStatus,
    apiErrorMessage: client.apiErrorMessage,
  };
}

/** The panel raises toasts for what it did; whether they render is IDE.tsx's business, not the tests'. */
export function toastModule() {
  return { toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } };
}
