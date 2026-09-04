import React from 'react';

import './GitPanel.scss';

import { GitCommit } from './GitCommit';
import { CommitGraphContainer } from './CommitGraphContainer';
import { PanelProps } from '../types';

export default function GitPanel({ hidden }: PanelProps) {
  return (
    <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
      <div className="content-head">
        <div className="z-label">Source control</div>
      </div>
      {/* One scroll area for the whole panel, not one per section. */}
      <div className="content-inner">
        <GitCommit hidden={hidden} />
        <h2 className="z-subheading panel-section-head">History</h2>
        <div className="panel-section-body">
          <CommitGraphContainer hidden={hidden} />
        </div>
      </div>
    </div>
  );
}
