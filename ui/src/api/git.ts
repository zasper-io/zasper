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

/**
 * Every read below carries `isRepository`, because a project directory is not obliged to be under git.
 * That is a state to render, not an error: without the flag "no uncommitted files" and "not a
 * repository" look the same, and they mean different things to whoever is reading the panel.
 */
export type UncommittedFiles = { files: string[]; isRepository: boolean };

export type CommitGraph = { commits: Commit[]; isRepository: boolean };

/** The branch the project is on, empty when the project is not a repository. */
export async function getCurrentBranch(): Promise<string> {
  const res = await requestJson<{ branch: string; isRepository: boolean }>('/api/current-branch');
  return res.branch;
}

export function getCommitGraph(): Promise<CommitGraph> {
  return requestJson<CommitGraph>('/api/commit-graph');
}

export function getUncommittedFiles(): Promise<UncommittedFiles> {
  return requestJson<UncommittedFiles>('/api/uncommitted-files');
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
