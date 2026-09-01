import React from 'react';

import { PanelProps } from './types';

export default function SecretsPanel({ display }: PanelProps) {
  return (
    <div className={display}>
      <div className="nav-content">
        <div className="content-head">
          <h6>Secrets</h6>
        </div>
        <div className="content-inner" />
      </div>
    </div>
  );
}
