import React from 'react';

function CellButtons(props) {
  return (
    <div className="cellOptionsDiv">
      <div className="cellOptions">
        <button
          type="button"
          className="editor-button"
          onClick={() => props.submitCell(props.code, props.cellId)}
        >
          <i className="fas fa-play" />
        </button>
        <button
          type="button"
          className="editor-button"
          onClick={() => props.copyCellByIndex(props.index)}
        >
          <i className="fas fa-copy" />
        </button>
        <button type="button" className="editor-button" onClick={() => props.nextCell(props.index)}>
          <i className="fas fa-forward" />
        </button>
        <button type="button" className="editor-button" onClick={() => props.prevCell(props.index)}>
          <i className="fas fa-backward" />
        </button>
        <button type="button" className="editor-button" onClick={() => props.addCellUp()}>
          <IconAddAbove />
        </button>
        <button type="button" className="editor-button" onClick={() => props.addCellDown()}>
          <IconAddBelow />
        </button>
        <button
          type="button"
          className="editor-button"
          onClick={() => props.deleteCell(props.index)}
        >
          <i className="fas fa-trash" />
        </button>
      </div>
    </div>
  );
}

const IconAddAbove = ({ size = 24, color = 'currentColor' }) => {
  const maskId = 'mask-plus-above';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <mask id={maskId}>
          <rect width="24" height="24" fill="white" />
          <path d="M6 12H12M9 9V15" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
        </mask>
      </defs>
      <rect x="1" y="7" width="16" height="10" rx="2" fill={color} mask={`url(#${maskId})`} />
      <path
        d="M19 11L21.5 8.5L24 11"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M21.5 8.5V16" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

const IconAddBelow = ({ size = 24, color = 'currentColor' }) => {
  const maskId = 'mask-plus-below';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <mask id={maskId}>
          <rect width="24" height="24" fill="white" />
          <path d="M6 12H12M9 9V15" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
        </mask>
      </defs>
      <rect x="1" y="7" width="16" height="10" rx="2" fill={color} mask={`url(#${maskId})`} />
      <path
        d="M19 13L21.5 15.5L24 13"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M21.5 15.5V8" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

export default CellButtons;
