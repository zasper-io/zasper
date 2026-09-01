import React from 'react';

import './GitPanel.scss';

import { GitCommit } from './GitCommit';
import { CommitGraphContainer } from './CommitGraphContainer';
import { PanelProps } from '../types';

export default function GitPanel({ display }: PanelProps) {
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
