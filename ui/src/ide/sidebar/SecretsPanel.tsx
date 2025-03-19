import React from 'react';

export default function SecretsPanel({ sendDataToParent, display }) {
  return (
    <div className={display}>
      <div className="nav-content">
        <div className="content-head">
          <h6>Secrets</h6>
        </div>
        <input
          type="text"
          placeholder="Search secrets"
          onChange={(e) => sendDataToParent(e.target.value)}
          className="search"
        />
        <div className="content-inner" />
      </div>
    </div>
  );
}
