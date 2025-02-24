import React, { useState } from "react";

import "./GitPanel.scss";

import { GitCommit } from "./GitCommit";
import { CommitGraphContainer } from "./CommitGraphContainer";

export default function GitPanel({ sendDataToParent, display }) {
  const [isHidden, setIsHidden] = useState<boolean>(false);

  return (
    <div className={display}>
      <div className="nav-content">
        <div className="content-head">
          <div>SOURCE CONTROL</div>
        </div>
        <div className="content-body">
          <GitCommit display={display} />
          <CommitGraphContainer />
        </div>
      </div>
    </div>
  );
}
