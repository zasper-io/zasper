import { requestJson, requestText } from './client';

/** One entry of /api/commit-graph. */
export type Commit = {
  hash: string;
  message: string;
  author: string;
  date: string;
  branch: string;
  parents: string[];
};

export async function getCurrentBranch(): Promise<string> {
  const res = await requestJson<{ branch: string }>('/api/current-branch');
  return res.branch;
}

export function getCommitGraph(): Promise<Commit[]> {
  return requestJson<Commit[]>('/api/commit-graph');
}

export function getUncommittedFiles(): Promise<string[]> {
  return requestJson<string[]>('/api/uncommitted-files');
}

/** Commits the given files, optionally pushing; resolves with the server's message. */
export function commitAndMaybePush(
  message: string,
  files: string[],
  push: boolean
): Promise<string> {
  return requestText('/api/commit-and-maybe-push', {
    method: 'POST',
    body: { message, files, push },
  });
}
