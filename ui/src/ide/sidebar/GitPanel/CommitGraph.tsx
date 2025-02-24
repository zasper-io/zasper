import { useEffect, useRef, useState } from "react";
import { Commit, CommitNode } from "./types";
import "./GitPanel.scss";
import * as d3 from "d3";
import dagreD3 from "dagre-d3";

export const CommitGraph: React.FC<{ data: Commit[] }> = ({ data }) => {
  const commits = data;
  console.log(data);
  const [commitNodes, setCommitNodes] = useState<CommitNode[]>([]);
  const [isHidden, setIsHidden] = useState<boolean>(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredCommit, setHoveredCommit] = useState<Commit | null>(null);

  useEffect(() => {
    // const commitMap: { [key: string]: CommitNode } = {};
    // data.forEach((commit) => {
    //   commitMap[commit.hash] = {
    //     id: commit.hash,
    //     x: 0,
    //     y: 0,
    //     children: [],
    //     commit: commit,
    //   };
    // });

    // // tree (children linked to parents)
    // data.forEach((commit) => {
    //   commit.parents.forEach((parentHash) => {
    //     if (commitMap[parentHash]) {
    //       commitMap[parentHash].children.push(commitMap[commit.hash]);
    //     }
    //   });
    // });

    const g = new dagreD3.graphlib.Graph().setGraph({});

    commits.forEach((commit, index) => {
      if (commit) {
        g.setNode(commit.hash, {
          label: `${commit.message} \n ${commit.author}`,
          class: "commit-node",
        });

        if (index > 0 && commits[index - 1]) {
          g.setEdge(commits[index - 1].hash, commit.hash, {
            class: "commit-edge",
          });
        }
      }
    });

    const svg = d3.select(svgRef.current);
    const inner = svg.select("g");
    const render = new dagreD3.render();
    render(inner, g);

    // Handle Hover
    // d3.selectAll(".commit-node").on("mouseover", function (event, d) {
    //   const commit = commits.find((c) => c.hash === d);
    //   setHoveredCommit(commit || null);
    // });

    // d3.selectAll(".commit-node").on("mouseout", function () {
    //   setHoveredCommit(null);
    // });

    // // Layout the tree using a simple recursive function
    // let yPosition = 100;
    // const layoutTree = (node: CommitNode, x: number) => {
    //   node.x = x;
    //   node.y = yPosition;
    //   yPosition += 150; // Adjust vertical spacing between nodes

    //   node.children.forEach((childNode, index) => {
    //     layoutTree(childNode, x + (index - node.children.length / 2) * 200); // Adjust horizontal spacing
    //   });
    // };

    // // Assuming root node is the first commit (no parents)
    // const rootCommit = data.find((commit) => commit.parents.length === 0);
    // if (rootCommit) {
    //   layoutTree(commitMap[rootCommit.hash], 400);
    // }

    // // Set the nodes to state
    // setCommitNodes(Object.values(commitMap));
  }, [data]);

  return (
    <div style={{ height: isHidden ? "0px" : "100%", margin:"0 10px" }}>
      <div className="projectName">
        <div onClick={() => setIsHidden(!isHidden)}>SOURCE CONTROL GRAPH</div>
      </div>

      
      <svg ref={svgRef} width="100%" height="500px" className="git-graph-svg">
        <g />
      </svg>

       {/* Hover Popup */}
      {hoveredCommit && (
        <div className="commit-popup">
          <p><strong>Commit:</strong> {hoveredCommit?.hash}</p>
          <p><strong>Message:</strong> {hoveredCommit?.message}</p>
          <p><strong>Author:</strong> {hoveredCommit?.author}</p>
        </div>
      )}

      {isHidden && (
        <div className="git-commit-content">
          <div className="graph-container">
            {commitNodes.map((node) => (
              <div
                key={node.id}
                className={`commit-node ${node.commit.branch}`}
                style={{
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                }}
              >
                <span className="commit-message">
                  {node.commit.message} -- {node.commit.author}
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
      )}
    </div>
  );
};
