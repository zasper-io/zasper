import { useEffect, useRef, useState } from "react";
import { Commit, CommitNode } from "./types";
import "./GitPanel.scss";

export const CommitGraph: React.FC<{ data: Commit[] }> = ({ data }) => {
  const [commitNodes, setCommitNodes] = useState<CommitNode[]>([]);

  useEffect(() => {
    const commitMap: { [key: string]: CommitNode } = {};
    data.forEach((commit) => {
      commitMap[commit.hash] = {
        id: commit.hash,
        x: 0,
        y: 0,
        children: [],
        commit: commit,
      };
    });

    // tree (children linked to parents)
    data.forEach((commit) => {
      commit.parents.forEach((parentHash) => {
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
    const rootCommit = data.find((commit) => commit.parents.length === 0);
    if (rootCommit) {
      layoutTree(commitMap[rootCommit.hash], 400);
    }

    // Set the nodes to state
    setCommitNodes(Object.values(commitMap));
  }, [data]);

  const truncateText = (text: string, maxLength: number) => {
    return text.length > maxLength
      ? text.substring(0, maxLength) + "..."
      : text;
  };

  return (
    <>
      <div className="projectName">
        <div>SOURCE CONTROL GRAPH</div>
      </div>
      <div className="git-commit-content">
        <div className="graph-container">
          {commitNodes.map((node, index) => (
            <div
              key={node.id}
              className={`commit-row`}
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
            >
              <div className="commit-circle" />
              {index < commitNodes.length - 1 && (
                <div className="commit-line" />
              )}
              <span className="commit-text">
                {truncateText(node.commit.message, 75)} -- {node.commit.author}
              </span>
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
      </div>
    </>
  );
};
