
import React, { useState, useEffect, useRef } from 'react';

import './GitPanel.scss' 

export default function GitPanel (props) {
  return (
    <div className='nav-content'>
      <div className='content-head'>
        <h6>Source Control Graph</h6>
      </div>
      <div className='content-inner'>
        <CommitGraphContainer></CommitGraphContainer>
      </div>
    </div>
  )
}

const CommitGraphContainer: React.FC = () => {
  const [commitData, setCommitData] = useState<Commit[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCommitData = async () => {
      try {
        const response = await fetch('http://localhost:8888/api/commit-graph');
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

type Commit = {
  hash: string;
  message: string;
  author: string;
  date: string;
  branch: string;
  parents: string[];
};

type CommitNode = {
  id: string;
  x: number;
  y: number;
  children: CommitNode[];
  commit: Commit;
};

const CommitGraph: React.FC<{ data: Commit[] }> = ({ data }) => {
  const [commitNodes, setCommitNodes] = useState<CommitNode[]>([]);

  useEffect(() => {
    const commitMap: { [key: string]: CommitNode } = {};
    data.forEach(commit => {
      commitMap[commit.hash] = {
        id: commit.hash,
        x: 0,
        y: 0,
        children: [],
        commit: commit,
      };
    });

    // tree (children linked to parents)
    data.forEach(commit => {
      commit.parents.forEach(parentHash => {
        if (commitMap[parentHash]) {
          commitMap[parentHash].children.push(commitMap[commit.hash]);
        }
      });
    });

    // Layout the tree using a simple recursive function
    let yPosition = 100;
    const layoutTree = (node: CommitNode, x: number) => {
      node.x = x;
      node.y = yPosition;
      yPosition += 150; // Adjust vertical spacing between nodes

      node.children.forEach((childNode, index) => {
        layoutTree(childNode, x + (index - node.children.length / 2) * 200); // Adjust horizontal spacing
      });
    };

    // Assuming root node is the first commit (no parents)
    const rootCommit = data.find(commit => commit.parents.length === 0);
    if (rootCommit) {
      layoutTree(commitMap[rootCommit.hash], 400);
    }

    // Set the nodes to state
    setCommitNodes(Object.values(commitMap));
  }, [data]);

  return (
    <div className="graph-container">
      {commitNodes.map(node => (
        <div
          key={node.id}
          className={`commit-node ${node.commit.branch}`}
          style={{ left: `${node.x}px`, top: `${node.y}px` }}
        >
          <span className="commit-message">{node.commit.message} -- {node.commit.author}</span>
          {/* <span className="commit-hash">{node.commit.hash}</span> */}
        </div>
      ))}

      {/* Lines to connect parent-child relationships */}
      {/* {commitNodes.map(node =>
        node.children.map(child => (
          <div
            key={`${node.id}-${child.id}`}
            className="connection-line"
            style={{
              left: `${node.x + 20}px`,
              top: `${node.y + 40}px`,
              width: `${Math.abs(node.x - child.x)}px`,
              height: `${Math.abs(node.y - child.y)}px`,
              transformOrigin: 'top left',
            }}
          />
        ))
      )} */}
    </div>
  );
};
