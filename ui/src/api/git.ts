import { requestJson } from './client';

/** One entry of the history. */
export type Commit = {
  hash: string;
  message: string;
  author: string;
  date: string;
  parents: string[];
};

export type CommitGraph = { commits: Commit[]; isRepository: boolean };

/**
 * One path that differs from HEAD. `staged` and `worktree` are git's own letters — M, A, D, R, C, ?,
 * U — or empty where that side of the index is unmodified, so either can be tested for truth.
 */
export type FileChange = {
  path: string;
  staged: string;
  worktree: string;
  /** Where a rename came from. */
  from?: string;
};

/**
 * Everything the panel needs to draw itself, and what every write answers with — so an action shows
 * its own effect rather than a status read racing behind it.
 *
 * `isRepository` is here for the same reason it was on the endpoints it replaces: a project directory
 * is not obliged to be under git, and that is a state to render rather than an error. `gitAvailable`
 * is the second of those states — no git binary means the changes can be listed but not changed.
 */
export type GitStatus = {
  isRepository: boolean;
  gitAvailable: boolean;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
  conflicted: FileChange[];
};

/** What the panel shows before it has heard from the server, and for a project with no repository. */
export const emptyGitStatus: GitStatus = {
  isRepository: false,
  gitAvailable: false,
  branch: '',
  upstream: '',
  ahead: 0,
  behind: 0,
  hasRemote: false,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
};

/**
 * One ref the panel can switch to.
 *
 * Remote-tracking refs are in the same list as this repository's own branches, marked: a fresh clone has
 * one local branch and everything a colleague made is only listed here, so leaving them out would leave
 * the menu unable to reach most of the work.
 */
export type Branch = {
  name: string;
  current: boolean;
  /** What it tracks, as `origin/main`, absent when it tracks nothing. */
  upstream?: string;
  hash?: string;
  isRemote: boolean;
};

/** The branch the project is on, empty when the project is not a repository. */
export async function getCurrentBranch(): Promise<string> {
  const res = await requestJson<{ branch: string; isRepository: boolean }>('/api/current-branch');
  return res.branch;
}

export function getGitStatus(): Promise<GitStatus> {
  return requestJson<GitStatus>('/api/git/status');
}

export function getCommitGraph(): Promise<CommitGraph> {
  return requestJson<CommitGraph>('/api/git/log');
}

export function stageFiles(paths: string[]): Promise<GitStatus> {
  return requestJson<GitStatus>('/api/git/stage', { method: 'POST', body: { paths } });
}

export function unstageFiles(paths: string[]): Promise<GitStatus> {
  return requestJson<GitStatus>('/api/git/unstage', { method: 'POST', body: { paths } });
}

/**
 * Throws away changes to `paths`. An untracked file has no version to go back to, so discarding it is
 * a delete: the server refuses one unless `deleteUntracked` says the caller means it.
 */
export function discardFiles(paths: string[], deleteUntracked = false): Promise<GitStatus> {
  return requestJson<GitStatus>('/api/git/discard', {
    method: 'POST',
    body: { paths, deleteUntracked },
  });
}

export function getBranches(): Promise<{ branches: Branch[]; isRepository: boolean }> {
  return requestJson<{ branches: Branch[]; isRepository: boolean }>('/api/git/branches');
}

/**
 * Switches branch, making one first when `create` says so. `from` is what a new branch starts at — a
 * branch, a tag or a commit — and defaults to whatever is checked out.
 *
 * A switch that would overwrite uncommitted work fails: git refuses it and names the files in the way,
 * and that message is what the toast carries.
 */
export function checkoutBranch(
  branch: string,
  options: { create?: boolean; from?: string } = {}
): Promise<GitStatus> {
  return requestJson<GitStatus>('/api/git/checkout', {
    method: 'POST',
    body: { branch, create: options.create ?? false, from: options.from ?? '' },
  });
}

/** Deletes a local branch. Without `force`, git refuses one whose commits are nowhere else. */
export function deleteBranch(name: string, force = false): Promise<GitStatus> {
  return requestJson<GitStatus>('/api/git/branches', {
    method: 'DELETE',
    body: { name, force },
  });
}

/** Updates the remote's refs and nothing else, which is what makes the ahead/behind counts true. */
export function fetchRemote(): Promise<GitStatus> {
  return requestJson<GitStatus>('/api/git/fetch', { method: 'POST' });
}

export function pullRemote(): Promise<GitStatus> {
  return requestJson<GitStatus>('/api/git/pull', { method: 'POST' });
}

export function pushRemote(): Promise<GitStatus> {
  return requestJson<GitStatus>('/api/git/push', { method: 'POST' });
}

/** Commits what is staged, and only that, optionally pushing afterwards. */
export function commitStaged(
  message: string,
  options: { push?: boolean; amend?: boolean } = {}
): Promise<GitStatus> {
  return requestJson<GitStatus>('/api/git/commit', {
    method: 'POST',
    body: { message, push: options.push ?? false, amend: options.amend ?? false },
  });
}
