import React from 'react';

export default function DebugPanel({ sendDataToParent, display }) {
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
