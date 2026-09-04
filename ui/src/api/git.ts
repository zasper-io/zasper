import { requestJson } from './client';

/**
 * One entry of the history.
 *
 * `subject` is the first line and `body` whatever is under it, split by the server the way git splits it:
 * the panel draws one line per commit, and cutting a whole message to fit put half of a merge commit's
 * conflict notes into a 200px row. `date` is RFC 3339, so `new Date(commit.date)` works — the old
 * endpoint sent Go's own time format, which no browser can parse.
 */
export type Commit = {
  hash: string;
  shortHash: string;
  subject: string;
  body?: string;
  author: string;
  email?: string;
  date: string;
  parents: string[];
};

/** One page of the history. `hasMore` is what decides whether another page is offered. */
export type GitLog = { commits: Commit[]; hasMore: boolean; isRepository: boolean };

/** One file of a commit. `status` is git's letter: A, M, D or R. */
export type CommitFile = {
  path: string;
  /** Where a rename came from, absent for everything else. */
  from?: string;
  status: string;
  insertions: number;
  deletions: number;
  /** Says the counts are meaningless rather than zero: git counts no lines in a PNG. */
  isBinary: boolean;
};

/** One commit and what it changed, which is what a row of the history expands into. */
export type CommitDetail = Commit & {
  files: CommitFile[];
  insertions: number;
  deletions: number;
  /** Says the file list was cut short, so part of a commit is not shown as all of it. */
  truncated: boolean;
};

/**
 * The two sides of one file's comparison, rather than a patch.
 *
 * Two whole documents because the viewer is a CodeMirror `MergeView`, which computes the difference
 * itself and needs both texts to do it. An absent side is an empty document, which is what makes an
 * added file read as all additions and a deleted one as all deletions with no flag for either.
 */
export type DiffDocuments = {
  path: string;
  /** The other name a renamed file had, absent for everything else. */
  from?: string;
  original: string;
  modified: string;
  /** Says the documents are empty because there was nothing readable to show, not because the file is. */
  isBinary: boolean;
  /** Says both sides are cell sources: outputs and execution counts are not in either of them. */
  isNotebook: boolean;
  /** The same for a file the server would not send, so the tab can say why it is empty. */
  tooLarge: boolean;
};

/** Which comparison of which file, as the diff tab and the panel rows both name one. */
export type DiffTarget = {
  path: string;
  /** HEAD against the index — what a commit would record — rather than the index against the disk. */
  staged?: boolean;
  /** A commit, when the comparison is that commit against its first parent. */
  ref?: string;
  /** The name a renamed file had, so the original side is read from it rather than read as absent. */
  from?: string;
};

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

/**
 * One page of the history, newest first.
 *
 * Paged because the old endpoint walked to the root commit every time it was asked — on boot, and again
 * after every commit, pull and branch switch.
 */
export function getLog(options: { limit?: number; skip?: number } = {}): Promise<GitLog> {
  return requestJson<GitLog>('/api/git/log', {
    query: { limit: options.limit, skip: options.skip },
  });
}

/** One commit and the files in it. A hash the repository does not have answers 404. */
export function getCommitDetail(hash: string): Promise<CommitDetail> {
  return requestJson<CommitDetail>(`/api/git/commit/${encodeURIComponent(hash)}`);
}

/**
 * The two sides of one file's comparison. A path neither side has answers 404, which is what a row
 * clicked after the file behind it was committed or discarded elsewhere gets.
 */
export function getDiff(target: DiffTarget): Promise<DiffDocuments> {
  return requestJson<DiffDocuments>('/api/git/diff', {
    query: {
      path: target.path,
      staged: target.staged ? true : undefined,
      ref: target.ref,
      from: target.from,
    },
  });
}

/**
 * Makes the project directory a repository, answering with the status it is then in.
 *
 * The server runs `git init` rather than creating one itself, so `init.defaultBranch` decides what the
 * first branch is called — the machine's own answer, not this panel's.
 */
export function initRepository(): Promise<GitStatus> {
  return requestJson<GitStatus>('/api/git/init', { method: 'POST' });
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
