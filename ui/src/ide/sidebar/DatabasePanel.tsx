import React from 'react';

import { PanelProps } from './types';

export default function DatabasePanel({ display }: PanelProps) {
  return (
    <div className={display}>
      <div className="nav-content">
        <div className="content-head">
          <h6>Database</h6>
        </div>
        <div className="content-inner" />
      </div>
    </div>
  );
}
