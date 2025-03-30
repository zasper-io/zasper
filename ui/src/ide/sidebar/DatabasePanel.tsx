import React from 'react';

export default function DatabasePanel({ display }) {
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
