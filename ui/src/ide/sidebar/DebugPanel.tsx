import React from 'react';

import { PanelProps } from './types';

export default function DebugPanel({ display }: PanelProps) {
  return (
    <div className={display}>
      <div className="nav-content">
        <div className="content-head">
          <h6>Debug</h6>
        </div>
        <div className="content-inner" />
      </div>
    </div>
  );
}
