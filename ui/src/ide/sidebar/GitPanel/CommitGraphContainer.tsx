import { useEffect, useState } from 'react';
import { Commit, getCommitGraph } from '@/api';
import { PanelProps } from '../types';
import './GitPanel.scss';

import { CommitGraph } from './CommitGraph';

interface CommitGraphContainerProps extends PanelProps {
  /**
   * Bumped by the panel after anything that could have added a commit. Without it the history is
   * whatever it was when the panel was opened, so the commit just made from the box above it is not in
   * the list it is sitting under. Not tied to every status read: that happens on each filesystem event,
   * and this walk is of the whole history.
   */
  reloadKey?: number;
}

export const CommitGraphContainer: React.FC<CommitGraphContainerProps> = ({
  hidden,
  reloadKey,
}) => {
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // As in useGitStatus: mounted but hidden means nobody is looking, so nothing is fetched until the
    // panel is opened, and then it is refetched so the history is not stale from last time.
    if (hidden) {
      return;
    }

    const fetchCommitData = async () => {
      try {
        const graph = await getCommitGraph();
        setCommits(graph.commits);
        setError(null);
      } catch (error) {
        console.error('Error fetching commit graph:', error);
        setError('Failed to load commit data');
      }
    };

    fetchCommitData();
  }, [hidden, reloadKey]);

  if (error) {
    return <div>{error}</div>;
  }

  if (!commits) {
    return <div>Loading...</div>;
  }

  // Covers both a project that is not a repository and one whose first commit has not happened yet;
  // the panel above says which.
  return commits.length > 0 ? <CommitGraph data={commits} /> : <div>No history.</div>;
};
