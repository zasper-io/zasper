import React from 'react';

import './GitPanel.scss';

import { GitCommit } from './GitCommit';
import { CommitGraphContainer } from './CommitGraphContainer';

export default function GitPanel({ display }) {
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
