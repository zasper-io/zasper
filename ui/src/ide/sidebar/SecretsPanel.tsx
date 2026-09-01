import React from 'react';

import { PanelProps } from './types';

export default function SecretsPanel({ hidden }: PanelProps) {
  return (
    <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
      <div className="content-head">
        <div className="z-label">Secrets</div>
      </div>
      <div className="content-inner" />
    </div>
  );
}
