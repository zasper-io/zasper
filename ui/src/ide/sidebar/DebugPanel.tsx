import React from 'react';

import { PanelProps } from './types';

export default function DebugPanel({ hidden }: PanelProps) {
  return (
    <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
      <div className="content-head">
        <div className="z-label">Debug</div>
      </div>
      <div className="content-inner" />
    </div>
  );
}
