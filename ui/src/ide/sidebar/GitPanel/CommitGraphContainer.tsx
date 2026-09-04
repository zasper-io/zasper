import { useEffect, useState } from 'react';
import { Commit, getCommitGraph } from '@/api';
import { PanelProps } from '../types';
import './GitPanel.scss';

import { CommitGraph } from './CommitGraph';

export const CommitGraphContainer: React.FC<PanelProps> = ({ hidden }) => {
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // As in GitCommit: mounted but hidden means nobody is looking, so nothing is fetched until the
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
  }, [hidden]);

  if (error) {
    return <div>{error}</div>;
  }

  if (!commits) {
    return <div>Loading...</div>;
  }

  // Covers both a project that is not a repository and one whose first commit has not happened yet;
  // GitCommit above says which.
  return commits.length > 0 ? <CommitGraph data={commits} /> : <div>No history.</div>;
};
