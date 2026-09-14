/**
 * What FileBrowser's tests put behind '@/api' and '@/browser'. Nothing here imports the app: a mock
 * factory that imported a module importing what it mocks would wait on itself.
 */
import { vi } from 'vitest';

export const getDirectory = vi.fn();
export const createContent = vi.fn();
export const renameContent = vi.fn();
export const deleteContent = vi.fn();
export const moveContent = vi.fn();
export const copyContent = vi.fn();
export const downloadContent = vi.fn();
export const uploadFile = vi.fn();
export const saveAs = vi.fn();
export const copyToClipboard = vi.fn();

export async function apiModule() {
  const client = await import('@/api/client');
  return {
    // Not stubbed: the real one only builds a URL, and the socket it is handed to is mocked anyway.
    websocketUrl: client.websocketUrl,
    getDirectory: (path: string) => getDirectory(path),
    createContent: (parentDir: string, type: string) => createContent(parentDir, type),
    renameContent: (parentDir: string, oldName: string, newName: string) =>
      renameContent(parentDir, oldName, newName),
    deleteContent: (path: string) => deleteContent(path),
    moveContent: (from: string, to: string) => moveContent(from, to),
    copyContent: (from: string, toDir: string) => copyContent(from, toDir),
    downloadContent: (path: string) => downloadContent(path),
    uploadFile: (request: unknown) => uploadFile(request),
    deleteKernel: vi.fn(),
    logApiError: () => () => {},
    // Not stubbed: what it reads out of a rejected request is what the panel shows, and the status on it
    // is how an upload tells a name that is taken from a failure it cannot answer.
    apiErrorMessage: client.apiErrorMessage,
    ApiError: client.ApiError,
  };
}

/** The two things only a browser can do: put a file on the reader's disk, and write their clipboard. */
export function browserModule() {
  return {
    saveAs: (blob: Blob, name: string) => saveAs(blob, name),
    copyToClipboard: (text: string) => copyToClipboard(text),
  };
}
