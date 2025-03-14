import { useEffect, useState } from 'react';
import { BaseApiUrl } from '../../config';

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
        const response = await fetch(BaseApiUrl + '/api/commit-graph');
        if (!response.ok) {
          throw new Error('Failed to fetch commits');
        }
        const data = await response.json();
        setCommitData(data);
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
