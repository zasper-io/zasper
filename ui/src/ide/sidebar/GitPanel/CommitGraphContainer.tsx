import { useEffect, useState } from 'react';
import { getCommitGraph } from '../../../api';

import { Commit } from './types';
import './GitPanel.scss';

import { CommitGraph } from './CommitGraph';

export const CommitGraphContainer: React.FC = () => {
  const [commitData, setCommitData] = useState<Commit[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCommitData = async () => {
      try {
        setCommitData(await getCommitGraph());
      } catch (error) {
        setError('Failed to load commit data');
      } finally {
        setLoading(false);
      }
    };

    fetchCommitData();
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>{error}</div>;
  }

  return commitData ? <CommitGraph data={commitData} /> : <div>No commit data available</div>;
};
