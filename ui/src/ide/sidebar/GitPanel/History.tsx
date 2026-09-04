import { useCallback, useEffect, useState } from 'react';

import { apiErrorMessage, Commit, getLog } from '@/api';
import CommitFiles from './CommitFiles';
import { fullDate, relativeDate } from './dates';
import { PanelProps } from '../types';

interface HistoryProps extends PanelProps {
  /**
   * Bumped by the panel after anything that could have added a commit. Without it the history is
   * whatever it was when the panel was opened, so the commit just made from the box above it is not in
   * the list it is sitting under. Not tied to every status read: that happens on each filesystem event.
   */
  reloadKey?: number;
}

/**
 * How many commits a page is.
 *
 * More than fits the panel, so the first screen never ends in a button, and far short of the whole
 * history: the endpoint this replaced walked to the root commit on every read, including after every
 * commit, pull and branch switch.
 */
const PAGE = 30;

/**
 * The history: newest first, a page at a time, each row opening onto what it changed.
 *
 * Not the graph the component this replaces was named for. That one computed a parent/child tree with an
 * x and a y per commit and then drew a flat list of `message -- author`, using neither, with no hash and
 * no date. Lanes and merge lines are a thing worth having; what was missing first was being able to tell
 * two commits apart.
 */
export default function History({ hidden, reloadKey }: HistoryProps) {
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [reading, setReading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  // Which row is open, by hash. One at a time: a panel this narrow with several file lists unfolded in
  // it is a page nobody can find their place in.
  const [open, setOpen] = useState<string>('');

  const read = useCallback(async (skip: number) => {
    setReading(true);
    try {
      const page = await getLog({ limit: PAGE, skip });
      // Appended rather than replaced, unless this is the first page: the pages before it are what the
      // reader has already scrolled past.
      setCommits((have) =>
        skip === 0 || have === null ? page.commits : [...have, ...page.commits]
      );
      setHasMore(page.hasMore);
      setError('');
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setReading(false);
    }
  }, []);

  useEffect(() => {
    // As in useGitStatus: mounted but hidden means nobody is looking, so nothing is fetched until the
    // panel is opened, and then it is read again since what is on screen is from last time.
    if (hidden) {
      return;
    }
    // Back to one page, because a commit or a checkout renumbers everything after it: skipping the
    // pages already loaded would then skip past commits that are new.
    setOpen('');
    void read(0);
  }, [hidden, reloadKey, read]);

  if (error !== '') {
    return (
      <div className="panel-error">
        <p>{error}</p>
      </div>
    );
  }
  if (commits === null) {
    return <p className="git-history-note">Loading…</p>;
  }
  // Covers both a project that is not a repository and one whose first commit has not happened yet;
  // the panel above says which.
  if (commits.length === 0) {
    return <p className="git-history-note">No history.</p>;
  }

  return (
    <>
      <ul className="git-history list-unstyled noborder-list">
        {commits.map((commit) => (
          <li key={commit.hash} className="commit-item">
            <button
              type="button"
              className="commit-summary"
              aria-expanded={open === commit.hash}
              title={`${commit.subject}\n\n${commit.author} · ${fullDate(commit.date)}`}
              onClick={() => setOpen((shown) => (shown === commit.hash ? '' : commit.hash))}
            >
              <span className="commit-subject">{commit.subject}</span>
              <span className="commit-meta">
                {/* The one thing in a row that names the commit for anything outside this panel: a
                    short hash can be pasted into a terminal, where "the first one -- Test" cannot. */}
                <span className="commit-short-hash">{commit.shortHash}</span>
                {/* A merge is worth marking even in a list with no lanes to draw it with: it is the one
                    row whose diff is against one parent of two. */}
                {commit.parents.length > 1 && <span className="commit-merge">merge</span>}
                <span className="commit-author">{commit.author}</span>
                <span className="commit-when">{relativeDate(commit.date)}</span>
              </span>
            </button>

            {open === commit.hash && <CommitFiles hash={commit.hash} />}
          </li>
        ))}
      </ul>

      {/* Offered from what the server said, not from a page that came back full: a history whose length
          is a multiple of the page size otherwise ends in a button with nothing behind it. */}
      {hasMore && (
        <button
          type="button"
          className="z-button z-button-secondary git-history-more"
          disabled={reading}
          onClick={() => void read(commits.length)}
        >
          Show more
        </button>
      )}
    </>
  );
}
